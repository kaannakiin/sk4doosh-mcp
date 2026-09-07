import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  compose,
  createCard,
  defaultSearchLimit,
  isMappedError,
  maxSearchLimit,
  SkMcpArgumentError,
  type CallerScope,
  type VisibilityDecision,
} from "@sk-mcp/core";
import { z } from "zod";
import type { CatalogEntry, SkMcpCatalog } from "./catalog.js";
import type { CallerScopeResolver } from "./cache.js";
import type { SkMcpDispatcher } from "./dispatcher.js";
import type { InvokeResultMapper } from "./invoke-result-mapper.js";
import type { OuterRequest, SkMcpOptions } from "./options.js";
import type { CallerVisibilityProvider } from "./visibility/provider.js";

export interface MetaToolDependencies {
  readonly catalog: SkMcpCatalog;
  readonly dispatcher: SkMcpDispatcher;
  readonly mapper: InvokeResultMapper;
  readonly visibility: CallerVisibilityProvider;
  readonly scopes: CallerScopeResolver;
  readonly options: SkMcpOptions;
}

interface ToolExtra {
  readonly requestInfo?: { readonly headers?: Record<string, unknown> };
}

const searchDescription =
  "Search the backend's API operations by keyword. Returns compact cards: name, short description and a parameter summary. An empty query lists operations by name. Keep queries short: a query term matches operation text by prefix. Call load_tool for the full input schema before invoke_tool.";

const loadDescription =
  "Load the full input schema of one operation. Call it before invoke_tool.";

const invokeDescription =
  "Invoke one backend operation with a JSON object of arguments.";

function unknownTool(name: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return errorResult(
    "unknown_tool",
    `No operation named '${name}'. Use search_tools to find the exact name.`,
  );
}

function errorResult(
  error: string,
  message: string,
): { content: { type: "text"; text: string }[]; isError: true } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error, message, retryable: false }),
      },
    ],
    isError: true,
  };
}

function textResult(
  payload: unknown,
  isError: boolean,
): { content: { type: "text"; text: string }[]; isError: boolean } {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError,
  };
}

function outerFrom(extra: unknown): OuterRequest | undefined {
  const headers = (extra as ToolExtra | undefined)?.requestInfo?.headers;
  return headers === undefined
    ? undefined
    : { headers: headers as OuterRequest["headers"] };
}

export function registerSkMcpTools(
  server: McpServer,
  deps: MetaToolDependencies,
): void {
  server.registerTool(
    "search_tools",
    {
      description: searchDescription,
      inputSchema: {
        query: z
          .string()
          .default("")
          .describe(
            "Keywords matched by prefix against operation names, descriptions, tags and routes. Empty lists everything.",
          ),
        limit: z
          .number()
          .int()
          .default(defaultSearchLimit)
          .describe("Maximum number of results, 1-50."),
      },
    },
    async ({ query, limit }, extra) => {
      deps.catalog.ensureValid();
      const outer = outerFrom(extra);
      const capped = Math.min(
        Math.max(limit ?? defaultSearchLimit, 1),
        maxSearchLimit,
      );
      const snapshot = deps.catalog.current;
      const ranked = snapshot.index.search(
        query ?? "",
        Math.max(snapshot.entries.length, 1),
      );
      const decide = await decider(deps, outer);

      const declarative = new Map<string, VisibilityDecision>();
      for (const name of ranked) {
        const entry = snapshot.byName.get(name);
        if (entry !== undefined) {
          declarative.set(name, decide(entry));
        }
      }

      const resolved = new Map(declarative);
      if (deps.options.visibility.tier === "probe") {
        const budget = Math.max(deps.options.visibility.probeTopK, 0);
        const queue = ranked.filter((name) => {
          const entry = snapshot.byName.get(name);
          return (
            entry !== undefined &&
            declarative.get(name) === "unknown" &&
            deps.visibility.canProbe(entry)
          );
        });
        const scope = scopeFor(deps, outer);
        for (const name of queue.slice(0, budget)) {
          const entry = snapshot.byName.get(name);
          if (entry === undefined) {
            continue;
          }
          resolved.set(name, await deps.visibility.probe(scope, entry, outer));
        }
      }

      const results: unknown[] = [];
      for (const name of ranked) {
        const entry = snapshot.byName.get(name);
        if (entry === undefined) {
          continue;
        }
        const decision = resolved.get(name) ?? "unknown";
        if (!deps.visibility.visible(decision)) {
          continue;
        }
        results.push(createCard(entry.tool, decision));
        if (results.length >= capped) {
          break;
        }
      }

      const total = [...snapshot.byName.values()].filter((entry) =>
        deps.visibility.visible(decide(entry)),
      ).length;

      return textResult({ total, results }, false);
    },
  );

  server.registerTool(
    "load_tool",
    {
      description: loadDescription,
      inputSchema: {
        name: z
          .string()
          .describe("Operation name exactly as returned by search_tools."),
      },
    },
    async ({ name }, extra) => {
      deps.catalog.ensureValid();
      const entry = deps.catalog.find(name);
      if (entry === undefined) {
        return unknownTool(name);
      }
      const outer = outerFrom(extra);
      const decide = await decider(deps, outer);
      let decision = decide(entry);
      if (
        decision === "unknown" &&
        deps.options.visibility.tier === "probe" &&
        deps.options.visibility.probeTopK > 0 &&
        deps.visibility.canProbe(entry)
      ) {
        decision = await deps.visibility.probe(
          scopeFor(deps, outer),
          entry,
          outer,
        );
      }
      if (!deps.visibility.visible(decision)) {
        return unknownTool(name);
      }
      return textResult(
        {
          name: entry.tool.name,
          description: entry.tool.description,
          inputSchema: entry.tool.inputSchema,
          annotations: entry.tool.annotations,
          ...(decision === "unknown" ? { authUncertain: true } : {}),
        },
        false,
      );
    },
  );

  server.registerTool(
    "invoke_tool",
    {
      description: invokeDescription,
      inputSchema: {
        name: z.string().describe("Operation name."),
        arguments: z
          .record(z.string(), z.unknown())
          .default({})
          .describe(
            "Arguments as a JSON object whose keys are the input schema's properties.",
          ),
      },
    },
    async ({ name, arguments: args }, extra) => {
      deps.catalog.ensureValid();
      const entry = deps.catalog.find(name);
      if (entry === undefined) {
        return unknownTool(name);
      }
      if (entry.template === undefined) {
        return errorResult(
          "not_invocable",
          `Operation '${name}' cannot be invoked through sk-mcp; see the catalog diagnostics.`,
        );
      }
      try {
        compose(entry.template, args ?? {});
      } catch (error) {
        if (error instanceof SkMcpArgumentError) {
          return errorResult(error.code, error.message);
        }
        throw error;
      }
      const result = await deps.dispatcher.dispatch(
        entry.template,
        args ?? {},
        outerFrom(extra),
      );
      const outcome = deps.mapper.map(result, knownFields(entry));
      return textResult(outcome, isMappedError(outcome));
    },
  );
}

function knownFields(entry: CatalogEntry): string[] {
  return Object.keys(entry.tool.inputSchema.properties ?? {});
}

async function decider(
  deps: MetaToolDependencies,
  outer: OuterRequest | undefined,
): Promise<(entry: CatalogEntry) => VisibilityDecision> {
  const snapshot = deps.catalog.current;
  const facts = await deps.visibility.facts(
    scopeFor(deps, outer),
    outer,
    snapshot.policyNames,
  );
  return (entry) => deps.visibility.decide(entry.descriptor.auth, facts);
}

function scopeFor(
  deps: MetaToolDependencies,
  outer: OuterRequest | undefined,
): CallerScope {
  return deps.scopes.resolve(outer);
}
