import type {
  McpServer,
  RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  compose,
  createCard,
  createDetail,
  defaultSearchLimit,
  describePayload,
  foldToken,
  forwardable,
  isInvokeError,
  maxSearchLimit,
  maxSearchTagVocabulary,
  narrowingArguments,
  refuseOversizeResponse,
  refuseTimedOutInvoke,
  sdkError,
  SkMcpArgumentError,
  type ArgumentFill,
  type CallerScope,
  type FieldError,
  type SdkErrorCode,
  type VisibilityDecision,
} from "@sk-mcp/core";
import { z } from "zod";
import type { CatalogEntry, SkMcpCatalog } from "./catalog.js";
import type { CallerScopeResolver } from "./cache.js";
import type { DispatchDeadline, SkMcpDispatcher } from "./dispatcher.js";
import type { InvokeResultMapper } from "./invoke-result-mapper.js";
import { callerOf } from "./options.js";
import type {
  InvokeTarget,
  OuterRequest,
  SkMcpOptions,
  VerifiedToken,
} from "./options.js";
import { currentOuterConnection } from "./outer-connection.js";
import { SkMcpDispatchAborted } from "./synthetic-context.js";
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
  readonly authInfo?: VerifiedToken;
  readonly signal?: AbortSignal;
}

export const catalogGenerationMetaKey = "sk-mcp/catalogGeneration";

const searchNarrowing: readonly FieldError[] = [
  { name: "query", message: "Keywords that select fewer operations." },
  { name: "limit", message: "Maximum number of results, 1-50." },
  { name: "detail", message: 'Use "card" for the compact shape.' },
  { name: "tags", message: "Tags every result must carry." },
];

const searchDescription =
  'Search the backend\'s API operations by keyword. An empty query lists operations by name. Keep queries short: a query term matches operation text by prefix. Results are compact cards — name, short description and a parameter summary — and load_tool gives the full input schema of the one you pick. When you already know which operation you want, pass detail="schema" with a small limit to get that schema here and skip the load_tool call.';

/**
 * Guard: `.catch` is what makes an unrecognised `detail` fall back to `card`
 * instead of failing validation. Without it zod rejects the call while the .NET
 * SDK, whose `[AllowedValues]` only decorates the published schema, answers with
 * cards — two SDKs disagreeing on one argument. It does not change the published
 * schema, which still carries `enum` and `default`.
 */
const detailDescription =
  'Shape of each result: "card" for the compact card, "schema" for the same shape load_tool returns. Any other value is card. A schema page is much larger; pair it with a small limit.';

const loadDescription =
  "Load the full definition of one operation: description, JSON input schema and behavior hints. Use the exact name returned by search_tools.";

const invokeDescription =
  "Invoke one backend operation with a JSON object of arguments.";

/** A meta-tool answer before it becomes a wire result: still an object, still measurable. */
interface MetaResponse {
  readonly payload: unknown;
  readonly isError: boolean;
  /** The value a refusal summarises; the payload itself when omitted. */
  readonly summaryOf?: unknown;
  /** The arguments a refusal names as narrowing this call. */
  readonly narrowing?: readonly FieldError[];
  /** The endpoint a per-endpoint budget override sees. */
  readonly target?: InvokeTarget;
}

interface WireResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: boolean;
}

function unknownTool(name: string): MetaResponse {
  return errorResult(
    "unknown_tool",
    `No operation named '${name}'. Use search_tools to find the exact name.`,
  );
}

function errorResult(error: SdkErrorCode, message: string): MetaResponse {
  return { payload: sdkError(error, message), isError: true };
}

function textResult(
  payload: unknown,
  isError: boolean,
  extras?: Omit<MetaResponse, "payload" | "isError">,
): MetaResponse {
  return { payload, isError, ...extras };
}

/**
 * The single place a `CallToolResult` is built, so no meta-tool answer can reach the agent without
 * passing the payload budget. It also swallows a handler throw: the MCP SDK's own catch emits
 * `error.message` verbatim, with no envelope and no leak filter, which would forward a stack or a
 * file path straight to the agent. Pinned by test/response-budget.spec.ts.
 */
async function emitGuarded(
  deps: MetaToolDependencies,
  produce: () => Promise<MetaResponse>,
): Promise<WireResult> {
  let response: MetaResponse;
  try {
    response = await produce();
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const safe = forwardable(raw);
    response = errorResult(
      "internal_error",
      safe === undefined
        ? "The operation failed inside the sk-mcp layer. Details were withheld."
        : `The operation failed inside the sk-mcp layer: ${safe}`,
    );
  }
  const text = JSON.stringify(response.payload) ?? "null";
  const bytes = Buffer.byteLength(text, "utf8");
  const limit = budgetFor(deps, response.target);
  if (bytes <= limit) {
    return { content: [{ type: "text", text }], isError: response.isError };
  }
  const refusal = refuseOversizeResponse({
    bytes,
    limit,
    shape: describePayload(response.summaryOf ?? response.payload),
    ...(response.narrowing === undefined
      ? {}
      : { narrowing: response.narrowing }),
  });
  return {
    content: [{ type: "text", text: JSON.stringify(refusal) }],
    isError: true,
  };
}

function timeoutFor(deps: MetaToolDependencies, target: InvokeTarget): number {
  const invoke = deps.options.invoke;
  return invoke.timeoutMsFor?.(target) ?? invoke.timeoutMs;
}

function budgetFor(
  deps: MetaToolDependencies,
  target: InvokeTarget | undefined,
): number {
  const invoke = deps.options.invoke;
  const override =
    target === undefined ? undefined : invoke.maxResponseBytesFor?.(target);
  return override ?? invoke.maxResponseBytes;
}

/**
 * The MCP call's cancellation channel, read separately from {@link outerFrom}.
 *
 * A stdio session has no `requestInfo`, so folding the signal into `OuterRequest` would either lose
 * it there or synthesize an outer request that never existed — which would start calling the host's
 * identity projector on a transport that carries no headers.
 */
function deadlineFrom(extra: unknown): DispatchDeadline | undefined {
  const signal = (extra as ToolExtra | undefined)?.signal;
  return signal === undefined ? undefined : { signal };
}

function outerFrom(extra: unknown): OuterRequest | undefined {
  const headers = (extra as ToolExtra | undefined)?.requestInfo?.headers;
  if (headers === undefined) {
    return undefined;
  }
  const connection = currentOuterConnection();
  const auth = (extra as ToolExtra | undefined)?.authInfo;
  return {
    headers: headers as OuterRequest["headers"],
    ...(connection === undefined ? {} : { connection }),
    ...(auth === undefined ? {} : { auth }),
  };
}

/** Every source this operation fills, paired with the value its provider returned. */
async function resolveDeferred(
  deps: MetaToolDependencies,
  entry: CatalogEntry,
  outer: OuterRequest | undefined,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const sources = deferredSourcesOf(entry);
  if (sources.size === 0) {
    return undefined;
  }
  const caller = callerOf(outer);
  const resolved: Record<string, unknown> = {};
  for (const source of sources) {
    const provider = deps.options.arguments.providers.get(source);
    if (provider === undefined) {
      continue;
    }
    const value = await provider(caller);
    if (value !== undefined) {
      resolved[source] = value;
    }
  }
  return resolved;
}

function deferredSourcesOf(entry: CatalogEntry): ReadonlySet<string> {
  const sources = new Set<string>();
  const take = (fill: ArgumentFill | undefined): void => {
    if (fill?.kind === "deferred" && typeof fill.source === "string") {
      sources.add(fill.source);
    }
  };
  for (const parameter of entry.template?.parameters ?? []) {
    take(parameter.fill);
  }
  for (const fill of entry.template?.bodyFills?.values() ?? []) {
    take(fill);
  }
  take(entry.template?.rootFill);
  return sources;
}

/**
 * The wire names the backend reports, mapped back to the names the agent knows.
 *
 * Without it a rename leaks the wire vocabulary into `fields[].name` and points the agent at an
 * argument it does not have.
 */
function vocabularyOf(entry: CatalogEntry): {
  readonly fieldAliases: Record<string, string>;
  readonly hiddenFields: string[];
} {
  const fieldAliases: Record<string, string> = {};
  const hiddenFields: string[] = [];
  for (const parameter of entry.template?.parameters ?? []) {
    if (parameter.fill !== undefined) {
      hiddenFields.push(parameter.name);
    } else if (parameter.argument !== undefined) {
      fieldAliases[parameter.name] = parameter.argument;
    }
  }
  for (const [agentName, wireName] of entry.template?.bodyAliases ?? []) {
    fieldAliases[wireName] = agentName;
  }
  for (const wireName of entry.template?.bodyFills?.keys() ?? []) {
    hiddenFields.push(wireName);
  }
  return { fieldAliases, hiddenFields };
}

export function registerSkMcpTools(
  server: McpServer,
  deps: MetaToolDependencies,
): () => void {
  const generationMeta = (): Record<string, unknown> => ({
    [catalogGenerationMetaKey]: deps.catalog.generation,
  });

  const search = server.registerTool(
    "search_tools",
    {
      description: searchDescription,
      _meta: generationMeta(),
      inputSchema: {
        query: z
          .string()
          .default("")
          .describe(
            "Keywords matched by prefix against operation names, descriptions, routes, argument names and tag text; keywords rank results, they do not filter them. Empty lists everything. To require a whole tag, use tags.",
          ),
        limit: z
          .number()
          .int()
          .default(defaultSearchLimit)
          .describe("Maximum number of results, 1-50."),
        detail: z
          .enum(["card", "schema"])
          .catch("card")
          .default("card")
          .describe(detailDescription),
        /**
         * Guard: `meta` publishes the `default: null` that the ASP.NET SDK emits for this argument
         * and cannot omit, because a C# array parameter's default has to be a compile-time
         * constant and `null` is the only one. Without it the two SDKs publish different schemas
         * for the same argument, which search-semantics.md makes contract. It decorates the
         * schema only; `parse` still yields `undefined` for an absent value. Pinned by T16 and by
         * test/meta-tools.spec.ts.
         */
        tags: z
          .array(z.string())
          .describe(
            "Tags every result must carry, matched against the whole tag and insensitive to case and accents. Empty applies no filter; the answer's tags field lists what is available.",
          )
          .optional()
          .meta({ default: null }),
      },
    },
    async ({ query, limit, detail, tags }, extra) =>
      emitGuarded(deps, async () => {
        deps.catalog.ensureValid();
        const outer = outerFrom(extra);
        const capped = Math.min(
          Math.max(limit ?? defaultSearchLimit, 1),
          maxSearchLimit,
        );
        const wantsSchema = detail === "schema";
        const snapshot = deps.catalog.current;
        const ranked = snapshot.index.search(
          query ?? "",
          Math.max(snapshot.entries.length, 1),
          tags,
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
            resolved.set(
              name,
              await deps.visibility.probe(scope, entry, outer),
            );
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
          results.push(
            wantsSchema
              ? createDetail(entry.tool, decision)
              : createCard(entry.tool, decision),
          );
          if (results.length >= capped) {
            break;
          }
        }

        const vocabulary = new Set<string>();
        let total = 0;
        for (const entry of snapshot.byName.values()) {
          if (!deps.visibility.visible(decide(entry))) {
            continue;
          }
          total += 1;
          for (const tag of entry.descriptor.tags ?? []) {
            vocabulary.add(foldToken(tag));
          }
        }
        const known =
          vocabulary.size === 0 || vocabulary.size > maxSearchTagVocabulary
            ? undefined
            : [...vocabulary].sort();

        return textResult(
          { total, results, ...(known === undefined ? {} : { tags: known }) },
          false,
          { summaryOf: results, narrowing: searchNarrowing },
        );
      }),
  );

  const load = server.registerTool(
    "load_tool",
    {
      description: loadDescription,
      _meta: generationMeta(),
      inputSchema: {
        name: z
          .string()
          .describe("Operation name exactly as returned by search_tools."),
      },
    },
    async ({ name }, extra) =>
      emitGuarded(deps, async () => {
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
        return textResult(createDetail(entry.tool, decision), false);
      }),
  );

  const invoke = server.registerTool(
    "invoke_tool",
    {
      description: invokeDescription,
      _meta: generationMeta(),
      inputSchema: {
        name: z
          .string()
          .describe("Operation name exactly as returned by search_tools."),
        /**
         * Guard: `unknown` rather than a record, so a non-object value reaches the handler and
         * leaves as an sk-mcp envelope. `z.record` rejected it during argument binding, which the
         * MCP SDK reports as a raw `-32602` with no envelope and no leak filter — the failure §9
         * closed for handler throws, reintroduced through the schema. `nonoptional` keeps the
         * argument required, which is what the ASP.NET SDK publishes. Pinned by
         * test/meta-tools.spec.ts and by T18.
         */
        arguments: z
          .unknown()
          .describe(
            "Arguments as a JSON object whose keys are the input schema's properties.",
          )
          .nonoptional(),
      },
    },
    async ({ name, arguments: args }, extra) =>
      emitGuarded(deps, async () => {
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
        const outer = outerFrom(extra);
        /**
         * Sources are resolved once per invocation and the same map feeds every composition, so a
         * source that is not constant cannot make validation and dispatch disagree.
         */
        let deferred: Readonly<Record<string, unknown>> | undefined;
        try {
          deferred = await resolveDeferred(deps, entry, outer);
          compose(entry.template, args ?? {}, deferred);
        } catch (error) {
          if (error instanceof SkMcpArgumentError) {
            return errorResult(error.code, error.message);
          }
          throw error;
        }
        const target: InvokeTarget = {
          tool: entry.tool.name,
          method: entry.descriptor.method,
          route: entry.descriptor.route,
        };
        const timeoutMs = timeoutFor(deps, target);
        let result;
        try {
          result = await deps.dispatcher.dispatch(
            entry.template,
            args ?? {},
            outer,
            deferred,
            { ...deadlineFrom(extra), timeoutMs },
          );
        } catch (error) {
          if (
            error instanceof SkMcpDispatchAborted &&
            error.reason === "timeout"
          ) {
            return { payload: refuseTimedOutInvoke(timeoutMs), isError: true };
          }
          throw error;
        }
        const outcome = deps.mapper.map(
          result,
          knownFields(entry),
          vocabularyOf(entry),
        );
        return textResult(outcome, isInvokeError(outcome), {
          summaryOf: isInvokeError(outcome) ? outcome : outcome.body,
          narrowing: narrowingArguments(entry.tool.inputSchema),
          target,
        });
      }),
  );

  const stamped: readonly RegisteredTool[] = [search, load, invoke];
  const release = deps.catalog.onChange(() => {
    const meta = generationMeta();
    for (const tool of stamped) {
      tool._meta = meta;
    }
    server.sendToolListChanged();
  });
  const inner = server.server;
  const previous = inner.onclose;
  inner.onclose = () => {
    release();
    previous?.();
  };
  return release;
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
