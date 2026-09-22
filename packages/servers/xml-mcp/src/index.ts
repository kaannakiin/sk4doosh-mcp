export { createXmlMcpServer, type XmlMcpServerOptions } from "./server.js";
export {
  createDocumentRoot,
  resolveDocumentPath,
  listDocuments,
} from "./host/platform/paths.js";
export type {
  DocumentEntry,
  DocumentListing,
  DocumentRoot,
} from "./host/platform/paths.js";
export { formats, type DocumentFormat } from "./host/platform/formats.js";
export { limits, workerCapacityFor } from "./host/platform/limits.js";
export { createGate, type Gate } from "./host/platform/gate.js";
export { vocabulary } from "./host/platform/vocabulary.js";
export {
  SkMcpXmlError,
  asXmlError,
  fail,
  type SkMcpXmlErrorCode,
} from "./host/platform/errors.js";
export {
  scanProlog,
  unsupportedPrologEncoding,
  type PrologScan,
  type UnsupportedPrologEncoding,
} from "./host/chunk/doctype.js";
export { HARDENED, forbiddenParseOptions } from "./engine/policy.js";
export {
  createXmlWorkerPool,
  type XmlWorkerPool,
  type XmlWorkerPoolOptions,
} from "./host/pool.js";
export {
  createXmlDocumentCache,
  type LoadedXmlDocument,
  type ResidentBody,
  type ResidentKind,
  type XmlDocumentCache,
} from "./host/document.js";
export {
  toolDefinitions,
  toolNames,
  type ToolHandlers,
  type ToolName,
} from "./tools/definitions.js";
export { createHandlers, type XmlHandlerDeps } from "./tools/handlers.js";
export { projectDiag } from "./engine/protocol.js";
export type {
  DiagProjection,
  ParsedFacts,
  ReadPage,
  ReadView,
  WorkerBodyOf,
  WorkerKind,
  WorkerRequestBody,
  WorkerResultOf,
} from "./model/worker.js";
export type {
  DescribeFacts,
  NamespaceAlias,
  RepetitionCandidate,
  RootFacts,
  StructureFacts,
} from "./model/describe.js";
export type {
  FindMatch,
  FindPage,
  FindProbe,
  MatchKind,
  MatchMode,
  SearchIn,
} from "./model/find.js";
export type {
  AttributeRecord,
  CharacterRecord,
  ElementRecord,
  ElementStep,
  EntityReferenceRecord,
  ExpandedName,
  NamespaceBinding,
  NodeAddress,
  NodeKind,
  NodePath,
  NodeRecord,
  ProcessingInstructionRecord,
} from "./model/node.js";
export type {
  AggregateOutcome,
  AggregateProbe,
  Cell,
  ColumnReport,
  ColumnSource,
  ColumnSpec,
  Condition,
  ConditionOp,
  GroupResult,
  ItemSelector,
  MemberKind,
  MetricFunction,
  MetricRequest,
  MetricValue,
  MultiplePolicy,
  NodeSetMember,
  NumberKind,
  NumericMode,
  RecordPage,
  RecordProbe,
  Row,
  Unaddressable,
  XPathOutcome,
  XPathProbe,
} from "./model/query.js";
export {
  cursorTtlMs,
  encodePosition,
  optionsHash,
  type CursorTool,
  type XmlCursor,
  type XmlCursorOf,
  type XmlPosition,
} from "./host/page/cursor.js";
export { lex, type Lexed } from "./host/xpath/lex.js";
export {
  diagnoseQuery,
  emptyResultDiagnostic,
  type QueryDiagnostic,
} from "./host/xpath/diagnosis.js";
export {
  assembleXPath,
  type NodeSetEnvelope,
  type XPathEnvelope,
  type XPathTruncation,
} from "./host/page/xpath.js";
export {
  assembleRecordPage,
  type RecordEnvelope,
  type RecordTruncation,
} from "./host/page/record.js";
export {
  assembleAggregate,
  type AggregateEnvelope,
  type MetricEcho,
  type AggregateTruncation,
} from "./host/page/aggregate.js";
