import { json } from "@sk-mcp/file-core";

import {
  createXmlDocumentCache,
  type XmlDocumentCache,
} from "../host/document.js";
import {
  createSpanCache,
  describeChunked,
  isRefusal,
  projectRecordsChunked,
  refusalError,
  type ChunkAsk,
} from "../host/chunk/chunked.js";
import { assembleAggregate } from "../host/page/aggregate.js";
import {
  assertFresh,
  assertSameOptions,
  decodeCursor,
  optionsHash,
} from "../host/page/cursor.js";
import { assembleFindPage } from "../host/page/find.js";
import { assembleRecordPage } from "../host/page/record.js";
import { assemblePage } from "../host/page/read.js";
import { assembleXPath } from "../host/page/xpath.js";
import { capabilitiesFor } from "../host/platform/capabilities.js";
import { SkMcpXmlError } from "../host/platform/errors.js";
import { createGate, type Gate } from "../host/platform/gate.js";
import { limits, modePolicy } from "../host/platform/limits.js";
import {
  listDocuments,
  resolveDocumentPath,
  type DocumentRoot,
  type SandboxedPath,
} from "../host/platform/paths.js";
import { createXmlWorkerPool, type XmlWorkerPool } from "../host/pool.js";
import { diagnoseQuery, refuseUnsupported } from "../host/xpath/diagnosis.js";
import {
  bindingsOf,
  columnIndex,
  columnsOf,
  conditionsOf,
  itemOf,
  metricsOf,
  refuseCombination,
  stepsOf,
} from "./coerce.js";
import type { ToolHandlers } from "./definitions.js";
import { guard } from "./guard.js";

export interface XmlHandlerDeps {
  readonly pool: XmlWorkerPool;
  readonly cache: XmlDocumentCache;
  readonly maxConcurrentListings?: number;
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

const surfaceLimits = {
  maxDocumentBytes: limits.maxXmlBytes,
  residentMaxBytes: limits.residentMaxBytes,
  maxChunkBytes: limits.maxChunkBytes,
  maxLiveChunkDoms: limits.maxLiveChunkDoms,
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
  const spans = createSpanCache(limits.documentCacheSize);
  pool.onGenerationChange(() => {
    spans.clear();
  });
  const askChunks: ChunkAsk = async (fragments, firstOccurrence, probe) => {
    const outcome = await pool.ask({
      kind: "projectChunks",
      fragments,
      firstOccurrence,
      probe,
    });
    if (!outcome.ok)
      throw outcome.failure === "doctype_not_allowed"
        ? new SkMcpXmlError(
            "doctype_not_allowed",
            "A record chunk declares a DOCTYPE.",
            "Remove the DOCTYPE declaration, or read a document that does not use one.",
          )
        : new SkMcpXmlError(
            "malformed_xml",
            "A record chunk is not well-formed XML.",
            "Fix the markup and read the file again.",
          );
    return outcome.value;
  };

  const refuseChunked = (tool: string, instead: string): never => {
    throw new SkMcpXmlError(
      "unsupported_for_format",
      `${tool} is not available for a document read in chunked mode: it needs the whole document resident, and this file is above the ${String(limits.residentMaxBytes)} byte resident budget.`,
      instead,
    );
  };

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
            mode: modePolicy,
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
          const facts =
            loaded.mode === "chunked"
              ? describeChunked(
                  loaded.survey,
                  loaded.root,
                  loaded.declaredEncoding,
                  maxCandidates,
                )
              : await cache.ask(
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
            mode: loaded.mode,
            capabilities: capabilitiesFor("xml", loaded.mode),
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
          if (loaded.mode === "chunked")
            refuseChunked(
              "read_node",
              "Use project_records with an itemAddress: in chunked mode a record carries occurrence instead of a node address.",
            );
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
              mode: loaded.mode,
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
          if (loaded.mode === "chunked")
            refuseChunked(
              "find_in_document",
              "Use project_records with an itemAddress and a where condition to filter records by value.",
            );
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
              mode: loaded.mode,
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
          if (loaded.mode === "chunked")
            refuseChunked(
              "select_xpath",
              "Use project_records with an itemAddress; XPath needs the whole document and is not carried into a chunk.",
            );
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
              mode: loaded.mode,
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
          const probe = {
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
          };

          const chunkedPage =
            loaded.mode === "chunked"
              ? await (async () => {
                  const resume =
                    cursor?.b === undefined
                      ? undefined
                      : { byte: cursor.b, ordinal: offset + 1 };
                  const scan = spans.scan(
                    loaded.stamp,
                    loaded.bytes,
                    item,
                    resume,
                  );
                  if (isRefusal(scan)) throw refusalError(scan);
                  return projectRecordsChunked(
                    loaded.bytes,
                    scan,
                    probe,
                    askChunks,
                  );
                })()
              : undefined;
          const page =
            chunkedPage?.page ??
            (await cache.ask(
              path,
              loaded.stamp,
              (stamp) => ({ kind: "records" as const, stamp, probe }),
              signal,
            ));

          return json(
            assembleRecordPage({
              filePath: args.filePath,
              snapshotId: loaded.stamp,
              mode: loaded.mode,
              optionsHash: hash,
              offset,
              page,
              ...(chunkedPage === undefined
                ? {}
                : { resumeBytes: chunkedPage.resumeBytes }),
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
          if (loaded.mode === "chunked")
            refuseChunked(
              "aggregate_document",
              "Use project_records and total the rows outside this server; a whole-document aggregate is not produced from chunks.",
            );

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
              mode: loaded.mode,
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
