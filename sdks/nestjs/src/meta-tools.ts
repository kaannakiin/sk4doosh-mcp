import type { McpServer } from "@modelcontextprotocol/server";
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
  normalizeInvokeArguments,
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
import { Logger } from "@nestjs/common";
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

interface ToolContext {
  readonly mcpReq?: { readonly signal?: AbortSignal };
  readonly http?: {
    readonly req?: { readonly headers: Headers };
    readonly authInfo?: VerifiedToken;
  };
}

export const catalogGenerationMetaKey = "sk-mcp/catalogGeneration";

const logger = new Logger("SkMcp");

const searchNarrowing: readonly FieldError[] = [
  { name: "query", message: "Keywords that select fewer operations." },
  { name: "limit", message: "Maximum number of results, 1-50." },
  { name: "detail", message: 'Use "card" for the compact shape.' },
  { name: "tags", message: "Tags every result must carry." },
];

const searchDescription =
  'Find operations when you do not know their exact names. Keywords rank matches; an empty query lists everything by name. Keep queries short: a term matches operation text by prefix. Results are compact cards — name, short description and a parameter summary. Set detail="schema" to get the full definition of every result in the same answer, which pays off only when you expect to invoke one of them immediately; pair it with a small limit because a schema page is much larger. When you already hold an exact operation name, call load_tool instead of searching for it.';

/**
 * Guard: `.catch` is what makes an unrecognised `detail` fall back to `card`
 * instead of failing validation. Without it zod rejects the call while the .NET
 * SDK, whose `[AllowedValues]` only decorates the published schema, answers with
 * cards — two SDKs disagreeing on one argument. It does not change the published
 * schema, which still carries `enum` and `default`.
 */
const detailDescription =
  'Shape of each result: "card" for the compact card, "schema" for the full definition load_tool would return. Any other value is card. A schema page is much larger; pair it with a small limit.';

const loadDescription =
  "Read the full definition of one operation: description, JSON input schema and behavior hints. Put the operation's exact name in the name argument. This is a direct lookup, not a search — it takes a name, never keywords. Use it after search_tools names an operation, or to re-read a schema whose name you already hold.";

/**
 * Guard: `name` binds as `unknown` and the object publishes its own `required`, so a call that
 * misspells the argument reaches the handler instead of the framework's validator. The published
 * schema is byte-identical to a plain `z.string()` one — `.meta` supplies the `type` the runtime
 * no longer implies. Without this the MCP SDK answers with a bare text error that is not JSON, so
 * the agent cannot parse it, the leak filter never runs, and the turn dies with nothing to repair
 * from. Measured: a model called `load_tool` with `operation` instead of `name`. Pinned by
 * test/meta-tools.spec.ts and by T19.
 */
function namedArgument(description: string) {
  return z.unknown().optional().meta({ type: "string", description });
}

const operationName = "Operation name exactly as returned by search_tools.";

function missingArgument(tool: string, argument: string): MetaResponse {
  return errorResult(
    "unknown_argument",
    `Tool '${tool}' was called without '${argument}', which is required. Call it again naming '${argument}' exactly.`,
  );
}

function wrongArgumentType(
  tool: string,
  argument: string,
  value: unknown,
): MetaResponse {
  return errorResult(
    "unknown_argument",
    `Tool '${tool}' takes '${argument}' as a string; ${typeof value} arrived. Call it again with '${argument}' set to an operation name from search_tools.`,
  );
}

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
 * A stdio session has no `ctx.http`, so folding the signal into `OuterRequest` would either lose it
 * there or synthesize an outer request that never existed — which would start calling the host's
 * identity projector on a transport that carries no headers.
 */
function deadlineFrom(ctx: unknown): DispatchDeadline | undefined {
  const signal = (ctx as ToolContext | undefined)?.mcpReq?.signal;
  return signal === undefined ? undefined : { signal };
}

/**
 * Guard: `ctx.http.req` is a Web `Request`, so its `Headers` has to be flattened into the Node
 * record every identity carrier and value provider in this SDK reads. Iterating `Headers` already
 * lower-cases each name and joins repeats with ", " — the same shape Node produces — so a carrier
 * configured for `x-tenant-id` keeps matching across the v1 to v2 move.
 */
function headersOf(headers: Headers): OuterRequest["headers"] {
  const record: Record<string, string> = {};
  for (const [name, value] of headers) {
    record[name] = value;
  }
  return record;
}

function outerFrom(ctx: unknown): OuterRequest | undefined {
  const request = (ctx as ToolContext | undefined)?.http?.req;
  if (request === undefined) {
    return undefined;
  }
  const connection = currentOuterConnection();
  const auth = (ctx as ToolContext | undefined)?.http?.authInfo;
  return {
    headers: headersOf(request.headers),
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
): void {
  const generationMeta = (): Record<string, unknown> => ({
    [catalogGenerationMetaKey]: deps.catalog.generation,
  });

  server.registerTool(
    "search_tools",
    {
      description: searchDescription,
      _meta: generationMeta(),
      inputSchema: z.object({
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
      }),
    },
    async ({ query, limit, detail, tags }, ctx) =>
      emitGuarded(deps, async () => {
        deps.catalog.ensureValid();
        const outer = outerFrom(ctx);
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

  server.registerTool(
    "load_tool",
    {
      description: loadDescription,
      _meta: generationMeta(),
      inputSchema: z
        .object({ name: namedArgument(operationName) })
        .meta({ required: ["name"] }),
    },
    async ({ name }, ctx) =>
      emitGuarded(deps, async () => {
        if (name === undefined) {
          return missingArgument("load_tool", "name");
        }
        if (typeof name !== "string") {
          return wrongArgumentType("load_tool", "name", name);
        }
        deps.catalog.ensureValid();
        const entry = deps.catalog.find(name);
        if (entry === undefined) {
          return unknownTool(name);
        }
        const outer = outerFrom(ctx);
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

  server.registerTool(
    "invoke_tool",
    {
      description: invokeDescription,
      _meta: generationMeta(),
      /**
       * Guard: `arguments` publishes a description and no `type`, so a value that is not an object
       * reaches the handler and leaves as an sk-mcp envelope. A schema that constrained it was
       * rejected during the framework's own argument binding, and the caller got an answer carrying
       * neither the envelope nor the leak filter. Pinned by test/meta-tools.spec.ts and by T18.
       */
      inputSchema: z
        .object({
          name: namedArgument(operationName),
          arguments: z.unknown().optional().meta({
            description:
              "Arguments as a JSON object whose keys are the input schema's properties. Send the object itself, not a string containing JSON.",
          }),
        })
        .meta({ required: ["name", "arguments"] }),
    },
    async ({ name, arguments: args }, ctx) =>
      emitGuarded(deps, async () => {
        if (name === undefined) {
          return missingArgument("invoke_tool", "name");
        }
        if (typeof name !== "string") {
          return wrongArgumentType("invoke_tool", "name", name);
        }
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
        const outer = outerFrom(ctx);
        const normalized = normalizeInvokeArguments(args);
        if (normalized.unwrapped) {
          logger.warn(
            `invoke_tool received the arguments for '${name}' as JSON text instead of a JSON object; the text was parsed. A client that double-encodes this argument is defective.`,
          );
        }
        /**
         * Sources are resolved once per invocation and the same map feeds every composition, so a
         * source that is not constant cannot make validation and dispatch disagree.
         */
        let deferred: Readonly<Record<string, unknown>> | undefined;
        try {
          deferred = await resolveDeferred(deps, entry, outer);
          compose(entry.template, normalized.value, deferred);
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
            normalized.value,
            outer,
            deferred,
            { ...deadlineFrom(ctx), timeoutMs },
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
