export { SkMcpExcelError, asExcelError } from "./errors.js";
export type { SkMcpExcelErrorCode } from "./errors.js";
export { limits } from "./limits.js";
export type { Limits } from "./limits.js";
export { formats } from "./formats.js";
export type { DocumentFormat } from "./formats.js";
export {
  createWorkbookRoot,
  isContained,
  listWorkbooks,
  resolveWorkbookPath,
} from "./paths.js";
export type {
  SandboxedPath,
  WorkbookEntry,
  WorkbookListing,
  WorkbookRoot,
} from "./paths.js";
export {
  advance,
  columnToLetters,
  formatCellRef,
  formatRange,
  formatRectangle,
  lettersToColumn,
  parseCellRef,
  resolveRange,
} from "./range.js";
export type { CellRef, GridBounds } from "./range.js";
export {
  assertFresh,
  decodeCursor,
  encodeCursor,
  fingerprint,
} from "./cursor.js";
export type { MergePolicy, SheetCursor, ValueMode } from "./cursor.js";
export { normalizeCell } from "./cell-value.js";
export type {
  CellNote,
  CellScalar,
  CellFacts,
  CellSnapshot,
  NormalizedCell,
} from "./cell-value.js";
export { buildColumnIndex, resolveColumn } from "./columns.js";
export type { ColumnIndex, ColumnMode } from "./columns.js";
export {
  classify,
  compareWithin,
  emptyCensus,
  evaluate,
  majorityKind,
  validateCondition,
} from "./predicate.js";
export type {
  CellKind,
  Census,
  ComparableKind,
  Condition,
  Operator,
  PredicateOptions,
} from "./predicate.js";
export {
  autoFilterRefOf,
  collectTables,
  declaredTablesOf,
  tableCountOf,
} from "./tables.js";
export type {
  DeclaredTableDetail,
  TableColumnDetail,
  TableReport,
} from "./tables.js";
export { requireSheetBounds } from "./sheet.js";
export type {
  BoundedSheet,
  DeclaredTable,
  RowView,
  SheetSource,
  SheetView,
} from "./sheet.js";
export { aggregateSheet } from "./aggregate.js";
export type {
  AggregateColumn,
  AggregateOptions,
  AggregateResult,
  MetricFunction,
  MetricRequest,
} from "./aggregate.js";
export { capabilities } from "./capabilities.js";
export type { FormatCapabilities } from "./capabilities.js";
export {
  csvSheetName,
  csvSheetView,
  delimiterNames,
  describeCsv,
  parseCsv,
  sniffDelimiter,
} from "./csv.js";
export type {
  CsvOptions,
  CsvReport,
  CsvTable,
  DelimiterName,
  EncodingName,
} from "./csv.js";
export {
  clearDocumentCache,
  csvReportOf,
  describeDocument,
  documentSheet,
  loadDocument,
} from "./document.js";
export type {
  DocumentDescription,
  LoadedCsv,
  LoadedDocument,
  LoadedWorkbook,
} from "./document.js";
export {
  describeWorkbook,
  parseXlsx,
  requireBounds,
  selectWorksheet,
  usedBounds,
} from "./workbook.js";
export type {
  DocumentMeta,
  SheetSummary,
  WorkbookDescription,
} from "./workbook.js";
export {
  collectConditionalFormats,
  conditionalFormatRuleCountOf,
  conditionalFormatsOf,
} from "./conditional-formats.js";
export type {
  ConditionalFormatReport,
  ConditionalFormatRule,
  ConditionalFormatThreshold,
} from "./conditional-formats.js";
export { collectImages, imageCountOf } from "./images.js";
export type { ImageReport, SheetImage } from "./images.js";
export { collectValidations, compressAddresses } from "./validations.js";
export type { ValidationReport, ValidationRule } from "./validations.js";
export { findInSheet, readSheet } from "./read-sheet.js";
export type {
  FindResult,
  ReadSheetOptions,
  ReadSheetResult,
} from "./read-sheet.js";
export { createHandlers, toolDefinitions, toolNames } from "./tools.js";
export type { ToolHandlers, ToolName } from "./tools.js";
export { createExcelMcpServer } from "./server.js";
