export { createXmlMcpServer, type XmlMcpServerOptions } from "./server.js";
export {
  createDocumentRoot,
  resolveDocumentPath,
  listDocuments,
} from "./paths.js";
export type { DocumentEntry, DocumentListing, DocumentRoot } from "./paths.js";
export { formats, type DocumentFormat } from "./formats.js";
export { limits, workerCapacityFor } from "./limits.js";
export { createGate, type Gate } from "./gate.js";
export { vocabulary } from "./vocabulary.js";
export {
  SkMcpXmlError,
  asXmlError,
  fail,
  type SkMcpXmlErrorCode,
} from "./errors.js";
export {
  scanProlog,
  unsupportedPrologEncoding,
  type PrologScan,
  type UnsupportedPrologEncoding,
} from "./doctype.js";
export { HARDENED, forbiddenParseOptions } from "./parse-policy.js";
export {
  createXmlWorkerPool,
  type XmlWorkerPool,
  type XmlWorkerPoolOptions,
} from "./worker-pool.js";
export {
  createXmlDocumentCache,
  type LoadedXmlDocument,
  type ResidentBody,
  type ResidentKind,
  type XmlDocumentCache,
} from "./document.js";
export {
  createHandlers,
  toolDefinitions,
  toolNames,
  type ToolHandlers,
  type ToolName,
  type XmlHandlerDeps,
} from "./tools.js";
export {
  projectDiag,
  type DiagProjection,
  type ParsedFacts,
  type ReadPage,
  type ReadView,
  type RootFacts,
  type WorkerBodyOf,
  type WorkerKind,
  type WorkerRequestBody,
  type WorkerResultOf,
} from "./worker-protocol.js";
export type {
  DescribeFacts,
  RepetitionCandidate,
  StructureFacts,
} from "./describe.js";
export type {
  FindMatch,
  FindPage,
  FindProbe,
  MatchKind,
  MatchMode,
  SearchIn,
} from "./find-model.js";
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
} from "./node-model.js";
export type { NamespaceAlias } from "./namespaces.js";
