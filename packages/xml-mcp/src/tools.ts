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
import { assembleFindPage } from "./find-page.js";
import { limits } from "./limits.js";
import type { ElementStep, NodeAddress } from "./node-model.js";
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
  xpath: false,
  recordProjection: false,
  aggregation: false,
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
  };
}
