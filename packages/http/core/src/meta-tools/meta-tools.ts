import {
  createCard,
  createDetail,
  defaultSearchLimit,
  maxSearchLimit,
  maxSearchTagVocabulary,
} from "../card.js";
import type { CatalogBuild, CatalogEntry } from "../catalog/pipeline.js";
import type { ArgumentFill } from "../generated/endpoint-descriptor.js";
import type { FieldError, SdkErrorCode } from "../generated/invoke-result.js";
import type { ToolDefinition } from "../generated/tool-definition.js";
import {
  describePayload,
  refuseOversizeResponse,
  sdkError,
} from "../invoke-guard.js";
import { forwardable } from "../leak-filter.js";
import type { RequestTemplate } from "../request-template.js";
import { foldToken } from "../search.js";
import type { VisibilityDecision } from "../visibility.js";

export const catalogGenerationMetaKey = "sk-mcp/catalogGeneration";

export const searchDescription =
  'Find operations when you do not know their exact names. Keywords rank matches; an empty query lists everything by name. Keep queries short: a term matches operation text by prefix. Results are compact cards — name, short description and a parameter summary. Set detail="schema" to get the full definition of every result in the same answer, which pays off only when you expect to invoke one of them immediately; pair it with a small limit because a schema page is much larger. When you already hold an exact operation name, call load_tool instead of searching for it.';

export const searchQueryDescription =
  "Keywords matched by prefix against operation names, descriptions, routes, argument names and tag text; keywords rank results, they do not filter them. Empty lists everything. To require a whole tag, use tags.";

export const searchLimitDescription = "Maximum number of results, 1-50.";

export const searchDetailDescription =
  'Shape of each result: "card" for the compact card, "schema" for the full definition load_tool would return. Any other value is card. A schema page is much larger; pair it with a small limit.';

export const searchTagsDescription =
  "Tags every result must carry, matched against the whole tag and insensitive to case and accents. Empty applies no filter; the answer's tags field lists what is available.";

export const loadDescription =
  "Read the full definition of one operation: description, JSON input schema and behavior hints. Put the operation's exact name in the name argument. This is a direct lookup, not a search — it takes a name, never keywords. Use it after search_tools names an operation, or to re-read a schema whose name you already hold.";

export const invokeDescription =
  "Invoke one backend operation with a JSON object of arguments.";

export const invokeArgumentsDescription =
  "Arguments as a JSON object whose keys are the input schema's properties. Send the object itself, not a string containing JSON.";

export const operationNameDescription =
  "Operation name exactly as returned by search_tools.";

export const searchNarrowing: readonly FieldError[] = [
  { name: "query", message: "Keywords that select fewer operations." },
  { name: "limit", message: "Maximum number of results, 1-50." },
  { name: "detail", message: 'Use "card" for the compact shape.' },
  { name: "tags", message: "Tags every result must carry." },
];

/**
 * A meta-tool answer before it becomes a wire result: still an object, still measurable.
 *
 * @param summaryOf the value a refusal summarises; the payload itself when omitted
 * @param narrowing the arguments a refusal names as narrowing this call
 * @param target what a per-endpoint budget override sees
 */
export interface MetaResponse<Target = unknown> {
  readonly payload: unknown;
  readonly isError: boolean;
  readonly summaryOf?: unknown;
  readonly narrowing?: readonly FieldError[];
  readonly target?: Target;
}

export interface WireResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: boolean;
}

export function errorResult(
  error: SdkErrorCode,
  message: string,
): MetaResponse<never> {
  return { payload: sdkError(error, message), isError: true };
}

export function textResult<Target>(
  payload: unknown,
  isError: boolean,
  extras?: Omit<MetaResponse<Target>, "payload" | "isError">,
): MetaResponse<Target> {
  return { payload, isError, ...extras };
}

export function unknownTool(name: string): MetaResponse<never> {
  return errorResult(
    "unknown_tool",
    `No operation named '${name}'. Use search_tools to find the exact name.`,
  );
}

export function notInvocable(name: string): MetaResponse<never> {
  return errorResult(
    "not_invocable",
    `Operation '${name}' cannot be invoked through sk-mcp; see the catalog diagnostics.`,
  );
}

export function missingArgument(
  tool: string,
  argument: string,
): MetaResponse<never> {
  return errorResult(
    "unknown_argument",
    `Tool '${tool}' was called without '${argument}', which is required. Call it again naming '${argument}' exactly.`,
  );
}

export function wrongArgumentType(
  tool: string,
  argument: string,
  value: unknown,
): MetaResponse<never> {
  return errorResult(
    "unknown_argument",
    `Tool '${tool}' takes '${argument}' as a string; ${typeof value} arrived. Call it again with '${argument}' set to an operation name from search_tools.`,
  );
}

/**
 * The single place a `CallToolResult` is built, so no meta-tool answer can reach the agent without
 * passing the payload budget. It also swallows a handler throw: the MCP SDK's own catch emits
 * `error.message` verbatim, with no envelope and no leak filter, which would forward a stack or a
 * file path straight to the agent. Pinned by sdks/nestjs test/response-budget.spec.ts.
 */
export async function emitGuarded<Target>(
  budgetFor: (target: Target | undefined) => number,
  produce: () => Promise<MetaResponse<Target>>,
): Promise<WireResult> {
  let response: MetaResponse<Target>;
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
  const limit = budgetFor(response.target);
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

/**
 * @param decide the declarative visibility decision for one entry
 * @param probe resolves an `unknown` decision for at most `budget` ranked entries; absent means
 * declarative visibility only
 */
export interface SearchRequest<Source extends object> {
  readonly catalog: CatalogBuild<Source>;
  readonly query: string | undefined;
  readonly limit: number | undefined;
  readonly detail: "card" | "schema" | undefined;
  readonly tags: readonly string[] | undefined;
  readonly decide: (entry: CatalogEntry<Source>) => VisibilityDecision;
  readonly visible: (decision: VisibilityDecision) => boolean;
  readonly probe?: {
    readonly budget: number;
    canProbe(entry: CatalogEntry<Source>): boolean;
    run(entry: CatalogEntry<Source>): Promise<VisibilityDecision>;
  };
}

export async function searchCatalog<Source extends object>(
  request: SearchRequest<Source>,
): Promise<MetaResponse<never>> {
  const { catalog, decide, visible } = request;
  const capped = Math.min(
    Math.max(request.limit ?? defaultSearchLimit, 1),
    maxSearchLimit,
  );
  const wantsSchema = request.detail === "schema";
  const ranked = catalog.index.search(
    request.query ?? "",
    Math.max(catalog.entries.length, 1),
    request.tags === undefined ? undefined : [...request.tags],
  );

  const declarative = new Map<string, VisibilityDecision>();
  for (const name of ranked) {
    const entry = catalog.byName.get(name);
    if (entry !== undefined) {
      declarative.set(name, decide(entry));
    }
  }

  const resolved = new Map(declarative);
  const probe = request.probe;
  if (probe !== undefined) {
    const queue = ranked.filter((name) => {
      const entry = catalog.byName.get(name);
      return (
        entry !== undefined &&
        declarative.get(name) === "unknown" &&
        probe.canProbe(entry)
      );
    });
    for (const name of queue.slice(0, Math.max(probe.budget, 0))) {
      const entry = catalog.byName.get(name);
      if (entry === undefined) {
        continue;
      }
      resolved.set(name, await probe.run(entry));
    }
  }

  const results: unknown[] = [];
  for (const name of ranked) {
    const entry = catalog.byName.get(name);
    if (entry === undefined) {
      continue;
    }
    const decision = resolved.get(name) ?? "unknown";
    if (!visible(decision)) {
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
  for (const entry of catalog.byName.values()) {
    if (!visible(decide(entry))) {
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
}

export function deferredSourcesOf(
  template: RequestTemplate | undefined,
): ReadonlySet<string> {
  const sources = new Set<string>();
  const take = (fill: ArgumentFill | undefined): void => {
    if (fill?.kind === "deferred" && typeof fill.source === "string") {
      sources.add(fill.source);
    }
  };
  for (const parameter of template?.parameters ?? []) {
    take(parameter.fill);
  }
  for (const fill of template?.bodyFills?.values() ?? []) {
    take(fill);
  }
  take(template?.rootFill);
  return sources;
}

export async function resolveDeferred<Caller>(
  template: RequestTemplate | undefined,
  providers: {
    get(source: string): ((caller: Caller) => unknown) | undefined;
  },
  caller: Caller,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const sources = deferredSourcesOf(template);
  if (sources.size === 0) {
    return undefined;
  }
  const resolved: Record<string, unknown> = {};
  for (const source of sources) {
    const provider = providers.get(source);
    if (provider === undefined) {
      continue;
    }
    const value: unknown = await provider(caller);
    if (value !== undefined) {
      resolved[source] = value;
    }
  }
  return resolved;
}

/**
 * The wire names the backend reports, mapped back to the names the agent knows.
 *
 * Without it a rename leaks the wire vocabulary into `fields[].name` and points the agent at an
 * argument it does not have.
 */
export function vocabularyOf(template: RequestTemplate | undefined): {
  readonly fieldAliases: Record<string, string>;
  readonly hiddenFields: string[];
} {
  const fieldAliases: Record<string, string> = {};
  const hiddenFields: string[] = [];
  for (const parameter of template?.parameters ?? []) {
    if (parameter.fill !== undefined) {
      hiddenFields.push(parameter.name);
    } else if (parameter.argument !== undefined) {
      fieldAliases[parameter.name] = parameter.argument;
    }
  }
  for (const [agentName, wireName] of template?.bodyAliases ?? []) {
    fieldAliases[wireName] = agentName;
  }
  for (const wireName of template?.bodyFills?.keys() ?? []) {
    hiddenFields.push(wireName);
  }
  return { fieldAliases, hiddenFields };
}

export function knownFields(tool: ToolDefinition): string[] {
  return Object.keys(tool.inputSchema.properties ?? {});
}
