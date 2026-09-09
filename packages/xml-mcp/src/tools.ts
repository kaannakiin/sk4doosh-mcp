import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  guard as coreGuard,
  json,
  readOnly,
  toolNamesOf,
  type ErrorContext,
  type GuardedHandler,
  type HandlersOf,
  type ToolDefinitions,
  type ToolInputOf,
  type ToolNameOf,
} from "@sk-mcp/file-core";
import { z } from "zod";
import {
  assertFresh,
  assertSameOptions,
  decodeCursor,
  optionsHash,
} from "./cursor.js";
import { createXmlDocumentCache, type XmlDocumentCache } from "./document.js";
import { createGate, type Gate } from "./gate.js";
import { asXmlError, fail, SkMcpXmlError } from "./errors.js";
import { assembleAggregate } from "./aggregate-envelope.js";
import { assembleFindPage } from "./find-page.js";
import { limits } from "./limits.js";
import type {
  ElementStep,
  NamespaceBinding,
  NodeAddress,
} from "./node-model.js";
import type {
  ColumnSource,
  ColumnSpec,
  Condition,
  ItemSelector,
  MetricFunction,
  MetricRequest,
  NumericMode,
} from "./query-model.js";
import { assembleRecordPage } from "./record-page.js";
import { diagnoseQuery, refuseUnsupported } from "./xpath-diagnosis.js";
import { assembleXPath } from "./xpath-page.js";
import {
  listDocuments,
  resolveDocumentPath,
  type DocumentRoot,
  type SandboxedPath,
} from "./paths.js";
import { assemblePage } from "./read-node.js";
import { createXmlWorkerPool, type XmlWorkerPool } from "./worker-pool.js";

const filePath = z
  .string()
  .describe(
    "Document path relative to the root, as returned by list_documents.",
  );

const addressStep = z.object({
  namespaceUri: z
    .string()
    .describe("Namespace URI of the element. Empty string means no namespace."),
  localName: z.string().min(1).describe("Local name of the element."),
  occurrence: z
    .int()
    .min(1)
    .optional()
    .describe(
      "1-based position among element siblings sharing this expanded name, default 1.",
    ),
});

const address = z
  .array(addressStep)
  .max(limits.maxDomDepth)
  .describe(
    "Segment path from the document element inclusive. Not an XPath expression; describe_document returns one you can pass straight back.",
  );

const expandedName = z.object({
  namespaceUri: z
    .string()
    .describe("Namespace URI of the element. Empty string means no namespace."),
  localName: z.string().min(1).describe("Local name of the element."),
});

const namespaceBindings = z
  .array(
    z.object({
      prefix: z
        .string()
        .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/u)
        .describe(
          "Prefix as written in the expression. Use the alias describe_document returned.",
        ),
      uri: z.string().min(1).describe("Namespace URI the prefix stands for."),
    }),
  )
  .max(limits.maxNamespaceBindings)
  .describe(
    "Prefix bindings for the expression. A prefix used but not bound is an error; the expression is never rewritten to guess one.",
  );

const itemAddress = z
  .object({
    ancestors: z
      .array(addressStep)
      .min(1)
      .max(limits.maxDomDepth)
      .describe(
        "Singular path to the element that holds the records, from the document element inclusive.",
      ),
    name: expandedName.describe(
      "Expanded name of the repeated child. Every child of the holder with this name is one record.",
    ),
  })
  .describe(
    "The record set: singular ancestors plus one repeated child name. This is not an XPath expression and the wildcard applies to the repeated child only.",
  );

const columns = z
  .array(
    z.object({
      label: z
        .string()
        .min(1)
        .max(64)
        .describe("Name for this column in the response. Must be unique."),
      ancestors: z
        .array(addressStep)
        .max(limits.maxColumnDepth)
        .optional()
        .describe(
          "Singular path from the record element, default the record itself.",
        ),
      name: expandedName
        .optional()
        .describe(
          "Terminal child name. Every child with this name is a candidate, which is what onMultiple decides about. Omit to read the addressed element itself.",
        ),
      value: z
        .discriminatedUnion("from", [
          z.object({ from: z.literal("text") }),
          z.object({
            from: z.literal("attribute"),
            namespaceUri: z.string(),
            localName: z.string().min(1),
          }),
          z.object({ from: z.literal("name") }),
        ])
        .optional()
        .describe(
          "text (default) joins the element's own text and CDATA children without descending, and marks the cell mixed when the element also has element children; attribute reads one attribute; name reads the local name.",
        ),
      onMultiple: z
        .enum(["error", "list", "first"])
        .optional()
        .describe(
          "Several matches in one record: error (default) marks that cell multiple with a count and no value, list returns the values, first takes the first. No policy silently picks one.",
        ),
    }),
  )
  .min(1)
  .max(limits.maxColumns);

const where = z
  .array(
    z.object({
      column: z.string().min(1).describe("Label of a declared column."),
      op: z.enum([
        "eq",
        "ne",
        "contains",
        "startsWith",
        "endsWith",
        "in",
        "isEmpty",
        "isNotEmpty",
        "isMissing",
        "isPresent",
      ]),
      value: z.string().optional(),
      values: z.array(z.string()).min(1).max(limits.maxInValues).optional(),
    }),
  )
  .max(limits.maxConditions)
  .describe(
    "Row filter over declared columns. Comparisons are textual: a multiple cell never matches one, and no value is converted to a number.",
  );

const match = z
  .enum(["all", "any"])
  .optional()
  .describe("Combine conditions with all (default) or any.");

const caseSensitive = z
  .boolean()
  .optional()
  .describe(
    "Case-sensitive comparison, default true. XML names and values are case-sensitive; false lowercases both sides and does not fold accents.",
  );

export const toolDefinitions = {
  list_documents: {
    description:
      "List readable XML documents under the server root. Returns filePath values that other tools accept verbatim. The listing never parses a file, so a listed path is a candidate, not a guarantee of well-formed XML. totalExact distinguishes a complete total; scanTruncated is separate from the result page limit.",
    inputSchema: z.object({
      subdirectory: z
        .string()
        .optional()
        .describe("Folder under the root to list."),
      pattern: z
        .string()
        .optional()
        .describe("Glob over the relative path, for example build/*.csproj."),
      maxResults: z
        .int()
        .min(1)
        .max(limits.maxListResults)
        .optional()
        .describe(
          "Maximum returned files, default 50. Does not increase the traversal budget.",
        ),
    }),
    annotations: readOnly,
  },
  describe_document: {
    description:
      "Summarise one XML document: the document element, every namespace with a stable alias, a bounded structure count, repeated-element candidates and an address read_node accepts. Repetition candidates are observations, not a schema. Counts carry an exact flag; a sampled count says so.",
    inputSchema: z.object({
      filePath,
      maxPaths: z
        .int()
        .min(1)
        .max(limits.maxDescribePaths)
        .optional()
        .describe(
          "Maximum repetition candidates and mixed-content examples, default 20.",
        ),
    }),
    annotations: readOnly,
  },
  read_node: {
    description:
      "Read a bounded, ordered slice of one document as flat depth-first records. Every record carries nodeId, parentId and childIndex, so text, element, comment and processing-instruction order survives a page boundary. Values are returned as written: no trimming, no number or date conversion. An element held back by maxDepth is marked childrenOmitted and needs its own call with that address; the cursor never delivers it.",
    inputSchema: z.object({
      filePath,
      address: address.optional(),
      maxDepth: z
        .int()
        .min(0)
        .max(limits.maxDomDepth)
        .optional()
        .describe(
          "Levels below the addressed node to descend, default unlimited within the depth ceiling. 0 returns that node alone.",
        ),
      maxNodes: z
        .int()
        .min(1)
        .max(limits.maxReadNodes)
        .optional()
        .describe(
          "Maximum records in one page, default 50. The response byte budget may stop the page earlier.",
        ),
      cursor: z
        .string()
        .optional()
        .describe(
          "nextCursor from a previous read_node response. Cannot be combined with address.",
        ),
    }),
    annotations: readOnly,
  },
  find_in_document: {
    description:
      "Find literal text in one document's text nodes and attribute values. Case-sensitive and literal: the query is never treated as a regular expression or a query language. totalMatches appears only when the scan finished; a stopped scan reports scannedCount and matchedSoFar instead.",
    inputSchema: z.object({
      filePath,
      query: z
        .string()
        .min(1)
        .describe("Literal text to look for. Case-sensitive; not a pattern."),
      matchMode: z
        .enum(["contains", "exact"])
        .optional()
        .describe("Substring match (default) or whole-value equality."),
      searchIn: z
        .enum(["text", "attributes", "both"])
        .optional()
        .describe(
          "Search text nodes (default), attribute values, or both. With both, a text hit and an attribute hit on the same element are reported separately.",
        ),
      scopeAddress: address
        .optional()
        .describe("Restrict the scan to this element's subtree."),
      maxResults: z
        .int()
        .min(1)
        .max(limits.maxFindResults)
        .optional()
        .describe("Maximum matches in one page, default 50."),
      cursor: z
        .string()
        .optional()
        .describe(
          "nextCursor from a previous find_in_document response. Cannot be combined with scopeAddress.",
        ),
    }),
    annotations: readOnly,
  },
  select_xpath: {
    description:
      "Evaluate one XPath 1.0 expression against a document. The expression is passed to the engine exactly as written: no rewriting, no namespace guessing, no extension functions, and nothing from XPath 2.0 or later. resultType separates a node-set from a string, number or boolean, so an empty node-set, an empty string, false and 0 all survive as themselves; a number carries numberKind so NaN and infinity are never a silent null. Node-set members are addressed where an address exists; a prolog comment and a namespace node carry unaddressable instead. Evaluation may materialise the whole node-set, so maxResults bounds the response, not the cost.",
    inputSchema: z.object({
      filePath,
      xpath: z
        .string()
        .min(1)
        .max(limits.maxXpathChars)
        .describe("XPath 1.0 expression."),
      namespaces: namespaceBindings.optional(),
      maxResults: z
        .int()
        .min(1)
        .max(limits.maxXpathResults)
        .optional()
        .describe(
          "Maximum node-set members in one page, default 50. The response byte budget may stop the page earlier. Ignored for a string, number or boolean result.",
        ),
      cursor: z
        .string()
        .optional()
        .describe(
          "nextCursor from a previous select_xpath response. The expression is evaluated again, so continuing costs what the first call cost.",
        ),
    }),
    annotations: readOnly,
  },
  project_records: {
    description:
      "Turn a repeated element into rows and named columns. Values are returned as written: no trimming, no number or date conversion. A cell says which of four things happened: present, empty when the value exists and is the empty string, missing when the address matches nothing, and multiple when several nodes match and no policy chose one. Rows carry occurrence rather than a repeated address; a row's canonical address is itemParentAddress plus itemName at that occurrence.",
    inputSchema: z.object({
      filePath,
      itemAddress,
      columns,
      where: where.optional(),
      match,
      caseSensitive,
      maxRows: z
        .int()
        .min(1)
        .max(limits.maxRows)
        .optional()
        .describe(
          "Maximum rows in one page, default 50. The response byte budget may stop the page earlier.",
        ),
      cursor: z
        .string()
        .optional()
        .describe(
          "nextCursor from a previous project_records response. Cannot be combined with different options.",
        ),
    }),
    annotations: readOnly,
  },
  aggregate_document: {
    description:
      "Count and summarise a repeated element in one call, instead of paging the records. count needs no column and is always available. sum, avg, min and max require numericMode: binary64, which is an explicit acceptance that values become binary64 doubles: a value with more digits than that holds is refused rather than quietly changed, and values that cannot be represented exactly are counted in rounded. groupCount and matchedItems cover the whole scan even when maxGroups cuts the returned groups.",
    inputSchema: z.object({
      filePath,
      itemAddress,
      columns,
      groupBy: z
        .array(z.string().min(1))
        .max(limits.maxMetrics)
        .optional()
        .describe(
          "Labels of declared columns to group by. Omit for one whole-set total.",
        ),
      metrics: z
        .array(
          z.object({
            fn: z.enum([
              "count",
              "countValues",
              "countDistinct",
              "sum",
              "avg",
              "min",
              "max",
            ]),
            column: z
              .string()
              .min(1)
              .optional()
              .describe(
                "Label of a declared column. Required for every metric except count.",
              ),
          }),
        )
        .min(1)
        .max(limits.maxMetrics),
      where: where.optional(),
      match,
      caseSensitive,
      numericMode: z
        .enum(["off", "binary64"])
        .optional()
        .describe(
          "off (default) offers only the counting metrics. binary64 enables sum, avg, min and max with double precision.",
        ),
      orderBy: z
        .enum(["group", "metric"])
        .optional()
        .describe("Order groups by group key (default) or by one metric."),
      orderByMetric: z
        .int()
        .min(1)
        .optional()
        .describe("One-based index into metrics, default 1."),
      descending: z
        .boolean()
        .optional()
        .describe("Descending order, default false."),
      maxGroups: z
        .int()
        .min(1)
        .max(limits.maxGroups)
        .optional()
        .describe(
          "Maximum groups returned, default 50. groupCount still reports every group the scan found.",
        ),
    }),
    annotations: readOnly,
  },
} as const satisfies ToolDefinitions;

type Definitions = typeof toolDefinitions;

export type ToolName = ToolNameOf<Definitions>;

export const toolNames: readonly ToolName[] = toolNamesOf(toolDefinitions);

type ToolInput<K extends ToolName> = ToolInputOf<Definitions, K>;

export type ToolHandlers = HandlersOf<Definitions>;

export interface XmlHandlerDeps {
  readonly pool: XmlWorkerPool;
  readonly cache: XmlDocumentCache;
  readonly maxConcurrentListings?: number;
}

export function guard<K extends ToolName>(
  context: ErrorContext & { readonly tool: K },
  handler: (
    args: ToolInput<K>,
    tool: K,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>,
): GuardedHandler<Definitions, K> {
  return coreGuard<Definitions, K>({ ...context, fail }, handler, asXmlError);
}

/**
 * K5: the queue gate is taken before the bytes are read, so a waiting request
 * never pins a snapshot. slots() rejects with a bare Error, which asXmlError
 * would otherwise flatten into internal_error.
 */
async function withSlot<T>(
  pool: XmlWorkerPool,
  run: () => Promise<T>,
): Promise<T> {
  let release: () => void;
  try {
    release = await pool.slots();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    throw new SkMcpXmlError(
      "resource_limit",
      reason === "queue_full"
        ? "Too many document reads are already waiting."
        : "The XML parse service is shutting down.",
      reason === "queue_full"
        ? "Retry once an earlier call finishes."
        : "Start a new server session.",
    );
  }
  try {
    return await run();
  } finally {
    release();
  }
}

function stepsOf(
  raw: readonly z.infer<typeof addressStep>[] | undefined,
): NodeAddress | undefined {
  if (raw === undefined) return undefined;
  return raw.map((step): ElementStep => ({
    namespaceUri: step.namespaceUri,
    localName: step.localName,
    occurrence: step.occurrence ?? 1,
  }));
}

type RawBindings = z.infer<typeof namespaceBindings>;
type RawColumns = z.infer<typeof columns>;
type RawWhere = z.infer<typeof where>;
type RawItem = z.infer<typeof itemAddress>;

function bindingsOf(raw: RawBindings | undefined): readonly NamespaceBinding[] {
  const seen = new Set<string>();
  const bound: NamespaceBinding[] = [];
  for (const binding of raw ?? []) {
    if (seen.has(binding.prefix)) {
      throw new SkMcpXmlError(
        "invalid_argument",
        `The prefix ${binding.prefix} is bound more than once.`,
        "Bind each prefix to one URI.",
      );
    }
    seen.add(binding.prefix);
    bound.push({ prefix: binding.prefix, uri: binding.uri });
  }
  return bound;
}

function sourceOf(raw: RawColumns[number]["value"]): ColumnSource {
  if (raw === undefined) return { from: "text" };
  if (raw.from === "attribute") {
    return {
      from: "attribute",
      attribute: { namespaceUri: raw.namespaceUri, localName: raw.localName },
    };
  }
  return { from: raw.from };
}

function columnsOf(raw: RawColumns): readonly ColumnSpec[] {
  const labels = new Set<string>();
  return raw.map((column) => {
    if (labels.has(column.label)) {
      throw new SkMcpXmlError(
        "invalid_argument",
        `Two columns are labelled ${column.label}.`,
        "Give every column a distinct label; where and groupBy address columns by label.",
      );
    }
    labels.add(column.label);
    return {
      label: column.label,
      ancestors: stepsOf(column.ancestors) ?? [],
      ...(column.name === undefined ? {} : { name: column.name }),
      source: sourceOf(column.value),
      onMultiple: column.onMultiple ?? "error",
    };
  });
}

function columnIndex(specs: readonly ColumnSpec[], label: string): number {
  const index = specs.findIndex((spec) => spec.label === label);
  if (index === -1) {
    throw new SkMcpXmlError(
      "invalid_argument",
      `There is no column labelled ${label}.`,
      `Declare it in columns first; the declared labels are ${specs.map((spec) => spec.label).join(", ")}.`,
    );
  }
  return index;
}

function conditionsOf(
  raw: RawWhere | undefined,
  specs: readonly ColumnSpec[],
): readonly Condition[] {
  return (raw ?? []).map((condition) => {
    if (condition.op === "in" && condition.values === undefined) {
      throw new SkMcpXmlError(
        "invalid_argument",
        "The in operator needs values.",
        "Pass values with at least one entry, or use eq.",
      );
    }
    return {
      column: columnIndex(specs, condition.column),
      op: condition.op,
      ...(condition.value === undefined ? {} : { value: condition.value }),
      ...(condition.values === undefined ? {} : { values: condition.values }),
    };
  });
}

function itemOf(raw: RawItem): ItemSelector {
  return { ancestors: stepsOf(raw.ancestors) ?? [], name: raw.name };
}

const countingMetrics = new Set(["count", "countValues", "countDistinct"]);

function metricsOf(
  raw: readonly { readonly fn: MetricFunction; readonly column?: string }[],
  specs: readonly ColumnSpec[],
  mode: NumericMode,
): readonly MetricRequest[] {
  return raw.map((metric) => {
    if (metric.fn !== "count" && metric.column === undefined) {
      throw new SkMcpXmlError(
        "invalid_argument",
        `The ${metric.fn} metric needs a column.`,
        "Name a declared column, or use count for a plain record count.",
      );
    }
    if (!countingMetrics.has(metric.fn) && mode === "off") {
      throw new SkMcpXmlError(
        "invalid_argument",
        `The ${metric.fn} metric converts text to a binary64 number, which this call did not ask for.`,
        "Pass numericMode: binary64 to accept double precision, or use count, countValues or countDistinct.",
      );
    }
    return {
      fn: metric.fn,
      ...(metric.column === undefined
        ? {}
        : { column: columnIndex(specs, metric.column) }),
    };
  });
}

function refuseCombination(field: string): never {
  throw new SkMcpXmlError(
    "invalid_argument",
    `cursor cannot be combined with ${field}.`,
    `Drop ${field}; the cursor pins the view it was produced for.`,
  );
}

const capabilities = {
  namespaceAwareAddressing: true,
  orderedMixedContent: true,
  literalSearch: true,
  xpath: true,
  recordProjection: true,
  aggregation: true,
  schemaValidation: false,
  streaming: false,
  typeInference: false,
  write: false,
} as const;

const surfaceLimits = {
  maxDocumentBytes: limits.maxXmlBytes,
  maxDepth: limits.maxDomDepth,
  maxNodesPerPage: limits.maxReadNodes,
  maxPayloadBytes: limits.maxPayloadBytes,
} as const;

const prologNote =
  "Comments and processing instructions that sit before the document element are not addressable in this version.";

export function createHandlers(
  root: DocumentRoot,
  deps?: XmlHandlerDeps,
): ToolHandlers {
  const pool = deps?.pool ?? createXmlWorkerPool();
  const cache = deps?.cache ?? createXmlDocumentCache(pool, root.real);
  const listings: Gate = createGate(
    deps?.maxConcurrentListings ?? limits.maxConcurrentListings,
    () => {
      throw new SkMcpXmlError(
        "resource_limit",
        "Too many listings are already running.",
        "Retry once an earlier list_documents call finishes.",
      );
    },
  );

  const open = async (raw: string): Promise<SandboxedPath> =>
    resolveDocumentPath(root, raw);

  return {
    list_documents: guard(
      { root: root.real, tool: "list_documents" },
      async (args) => {
        const release = listings.enter();
        try {
          const listing = await listDocuments(root, {
            ...(args.subdirectory === undefined
              ? {}
              : { subdirectory: args.subdirectory }),
            ...(args.pattern === undefined ? {} : { pattern: args.pattern }),
            maxResults: args.maxResults ?? limits.defaultListResults,
          });
          return json({ root: root.real, ...listing });
        } finally {
          release();
        }
      },
    ),
    describe_document: guard(
      { root: root.real, tool: "describe_document" },
      async (args, _tool, signal) =>
        withSlot(pool, async () => {
          const maxCandidates = args.maxPaths ?? limits.defaultDescribePaths;
          const path = await open(args.filePath);
          const loaded = await cache.load(path);
          const facts = await cache.ask(
            path,
            loaded.stamp,
            (stamp) => ({
              kind: "describe" as const,
              stamp,
              maxVisits: limits.maxDescribeVisits,
              maxCandidates,
            }),
            signal,
          );
          return json({
            filePath: args.filePath,
            snapshotId: loaded.stamp,
            sizeBytes: loaded.sizeBytes,
            modifiedAt: loaded.modifiedAt,
            root: facts.root,
            rootAddress: facts.rootAddress,
            declaredEncoding: facts.declaredEncoding,
            warningCount: facts.warningCount,
            namespaces: facts.namespaces,
            namespacesComplete: facts.namespacesComplete,
            structure: facts.structure,
            repetitionCandidates: facts.repetitionCandidates,
            mixedContent: facts.mixedContent,
            exampleAddress: facts.exampleAddress,
            capabilities,
            limits: surfaceLimits,
            notes: [prologNote],
          });
        }),
    ),
    read_node: guard(
      { root: root.real, tool: "read_node" },
      async (args, _tool, signal) =>
        withSlot(pool, async () => {
          const maxDepth = args.maxDepth ?? limits.maxDomDepth;
          const maxNodes = args.maxNodes ?? limits.defaultReadNodes;
          const hash = optionsHash({ maxDepth, maxNodes });
          const cursor =
            args.cursor === undefined
              ? undefined
              : decodeCursor(args.cursor, "read");
          if (cursor !== undefined) {
            if (args.address !== undefined) refuseCombination("address");
            assertSameOptions(cursor, hash);
          }
          const path = await open(args.filePath);
          const loaded = await cache.load(path);
          if (cursor !== undefined) assertFresh(cursor, loaded.stamp);

          const scope =
            cursor === undefined
              ? { address: stepsOf(args.address) }
              : { scopePath: cursor.s, resume: cursor.p };

          const page = await cache.ask(
            path,
            loaded.stamp,
            (stamp) => ({
              kind: "read" as const,
              stamp,
              view: {
                maxDepth,
                maxNodes,
                maxChars: limits.maxStringChars,
                ...(scope.address === undefined
                  ? {}
                  : { address: scope.address }),
                ...(scope.scopePath === undefined
                  ? {}
                  : { scopePath: scope.scopePath, resume: scope.resume }),
              },
            }),
            signal,
          );

          return json(
            assemblePage({
              filePath: args.filePath,
              snapshotId: loaded.stamp,
              optionsHash: hash,
              page,
            }),
          );
        }),
    ),
    find_in_document: guard(
      { root: root.real, tool: "find_in_document" },
      async (args, _tool, signal) =>
        withSlot(pool, async () => {
          const matchMode = args.matchMode ?? "contains";
          const searchIn = args.searchIn ?? "text";
          const maxResults = args.maxResults ?? limits.defaultFindResults;
          const hash = optionsHash({
            query: args.query,
            matchMode,
            searchIn,
            maxResults,
          });
          const cursor =
            args.cursor === undefined
              ? undefined
              : decodeCursor(args.cursor, "find");
          if (cursor !== undefined) {
            if (args.scopeAddress !== undefined)
              refuseCombination("scopeAddress");
            assertSameOptions(cursor, hash);
          }
          const path = await open(args.filePath);
          const loaded = await cache.load(path);
          if (cursor !== undefined) assertFresh(cursor, loaded.stamp);

          const scopeAddress =
            cursor === undefined ? stepsOf(args.scopeAddress) : undefined;

          const page = await cache.ask(
            path,
            loaded.stamp,
            (stamp) => ({
              kind: "find" as const,
              stamp,
              probe: {
                query: args.query,
                matchMode,
                searchIn,
                maxResults,
                maxChars: limits.maxStringChars,
                maxVisits: limits.maxFindVisits,
                ...(scopeAddress === undefined ? {} : { scopeAddress }),
                ...(cursor === undefined
                  ? {}
                  : { scopePath: cursor.s, resume: cursor.p }),
              },
            }),
            signal,
          );

          return json(
            assembleFindPage({
              filePath: args.filePath,
              snapshotId: loaded.stamp,
              optionsHash: hash,
              page,
              maxResults,
            }),
          );
        }),
    ),
    select_xpath: guard(
      { root: root.real, tool: "select_xpath" },
      async (args, _tool, signal) =>
        withSlot(pool, async () => {
          const refusal = refuseUnsupported(args.xpath);
          if (refusal !== undefined) throw refusal;
          const bindings = bindingsOf(args.namespaces);
          const maxResults = args.maxResults ?? limits.defaultXpathResults;
          const hash = optionsHash({
            xpath: args.xpath,
            bindings,
            maxResults,
          });
          const cursor =
            args.cursor === undefined
              ? undefined
              : decodeCursor(args.cursor, "xpath");
          if (cursor !== undefined) assertSameOptions(cursor, hash);
          const path = await open(args.filePath);
          const loaded = await cache.load(path);
          if (cursor !== undefined) assertFresh(cursor, loaded.stamp);

          const outcome = await cache.ask(
            path,
            loaded.stamp,
            (stamp) => ({
              kind: "xpath" as const,
              stamp,
              probe: {
                expression: args.xpath,
                bindings,
                offset: cursor?.i ?? 0,
                maxResults,
                maxChars: limits.maxStringChars,
              },
            }),
            signal,
            (failure, detail) =>
              failure === "xpath_compile" || failure === "xpath_eval"
                ? diagnoseQuery(failure, detail, args.xpath, bindings)
                : undefined,
          );

          return json(
            assembleXPath({
              filePath: args.filePath,
              snapshotId: loaded.stamp,
              optionsHash: hash,
              expression: args.xpath,
              rootNamespaceUri: loaded.root.namespaceUri,
              outcome,
            }),
          );
        }),
    ),
    project_records: guard(
      { root: root.real, tool: "project_records" },
      async (args, _tool, signal) =>
        withSlot(pool, async () => {
          const specs = columnsOf(args.columns);
          const item = itemOf(args.itemAddress);
          const conditions = conditionsOf(args.where, specs);
          const match = args.match ?? "all";
          const caseSensitive = args.caseSensitive ?? true;
          const maxRows = args.maxRows ?? limits.defaultRows;
          const hash = optionsHash({
            item,
            specs,
            conditions,
            match,
            caseSensitive,
            maxRows,
          });
          const cursor =
            args.cursor === undefined
              ? undefined
              : decodeCursor(args.cursor, "records");
          if (cursor !== undefined) assertSameOptions(cursor, hash);
          const path = await open(args.filePath);
          const loaded = await cache.load(path);
          if (cursor !== undefined) assertFresh(cursor, loaded.stamp);
          const offset = cursor?.i ?? 0;

          const page = await cache.ask(
            path,
            loaded.stamp,
            (stamp) => ({
              kind: "records" as const,
              stamp,
              probe: {
                item,
                columns: specs,
                where: conditions,
                match,
                caseSensitive,
                offset,
                maxRows,
                maxChars: limits.maxStringChars,
                maxCellValues: limits.maxCellValues,
                maxItemVisits: limits.maxItemVisits,
              },
            }),
            signal,
          );

          return json(
            assembleRecordPage({
              filePath: args.filePath,
              snapshotId: loaded.stamp,
              optionsHash: hash,
              offset,
              page,
            }),
          );
        }),
    ),
    aggregate_document: guard(
      { root: root.real, tool: "aggregate_document" },
      async (args, _tool, signal) =>
        withSlot(pool, async () => {
          const specs = columnsOf(args.columns);
          const item = itemOf(args.itemAddress);
          const numericMode = args.numericMode ?? "off";
          const metrics = metricsOf(args.metrics, specs, numericMode);
          const orderByMetric = args.orderByMetric ?? 1;
          if (orderByMetric > metrics.length) {
            throw new SkMcpXmlError(
              "invalid_argument",
              `orderByMetric is ${String(orderByMetric)} but only ${String(metrics.length)} metrics were requested.`,
              "Use a one-based index into metrics.",
            );
          }
          const path = await open(args.filePath);
          const loaded = await cache.load(path);

          const outcome = await cache.ask(
            path,
            loaded.stamp,
            (stamp) => ({
              kind: "aggregate" as const,
              stamp,
              probe: {
                item,
                columns: specs,
                groupBy: (args.groupBy ?? []).map((label) =>
                  columnIndex(specs, label),
                ),
                metrics,
                where: conditionsOf(args.where, specs),
                match: args.match ?? "all",
                caseSensitive: args.caseSensitive ?? true,
                numericMode,
                orderBy: args.orderBy ?? "group",
                orderByMetric,
                descending: args.descending ?? false,
                maxGroups: args.maxGroups ?? limits.defaultGroups,
                maxChars: limits.maxStringChars,
                maxCellValues: limits.maxCellValues,
                maxItemVisits: limits.maxItemVisits,
              },
            }),
            signal,
          );

          return json(
            assembleAggregate({
              filePath: args.filePath,
              snapshotId: loaded.stamp,
              numericMode,
              metrics: args.metrics.map((metric) => ({
                fn: metric.fn,
                ...(metric.column === undefined
                  ? {}
                  : { column: metric.column }),
              })),
              outcome,
            }),
          );
        }),
    ),
  };
}
