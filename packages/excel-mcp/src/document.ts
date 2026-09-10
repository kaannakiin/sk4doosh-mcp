import type { Workbook } from "exceljs";
import {
  createDocumentStore,
  type DocumentStore,
  type OpenedFile,
  type ParseContext,
  type SandboxedPath,
} from "@sk-mcp/file-core";
import { capabilities } from "./capabilities.js";
import {
  csvSheetName,
  csvSheetView,
  describeCsv,
  parseCsv,
  type CsvOptions,
  type CsvReport,
  type CsvTable,
} from "./csv.js";
import { SkMcpExcelError, fail } from "./errors.js";
import { formats, type DocumentFormat } from "./formats.js";
import { limits, modePolicy } from "./limits.js";
import { assertReadableFormat } from "./paths.js";
import type { SheetSource, SheetView } from "./sheet.js";
import { vocabulary } from "./vocabulary.js";
import {
  describeWorkbook,
  parseXlsx,
  selectWorksheet,
  xlsxSheetView,
  type DocumentMeta,
  type WorkbookDescription,
} from "./workbook.js";

interface XlsxBody {
  readonly format: "xlsx";
  readonly workbook: Workbook;
}

interface CsvBody {
  readonly format: "csv";
  readonly table: CsvTable;
}

type DocumentBody = XlsxBody | CsvBody;

export type LoadedWorkbook = XlsxBody & OpenedFile;
export type LoadedCsv = CsvBody & OpenedFile;
export type LoadedDocument = LoadedWorkbook | LoadedCsv;

async function parseDocument(
  context: ParseContext,
  options: CsvOptions,
): Promise<DocumentBody> {
  const format = formats.formatFor(context.path);
  const bytes =
    context.mode === "resident"
      ? context.bytes
      : await context.source.read({
          offset: 0,
          length: context.source.sizeBytes,
        });
  if (format === "csv") {
    const table = await parseCsv(
      bytes,
      context.sizeBytes,
      options,
      context.displayPath,
    );
    return { format, table };
  }
  assertReadableFormat(bytes.subarray(0, 8), context.displayPath);
  const workbook = await parseXlsx(bytes, context.displayPath);
  return { format, workbook };
}

function variantKey(options: CsvOptions): string {
  return [options.delimiter ?? "", options.encoding ?? ""].join(":");
}

export interface DocumentCache {
  load(path: SandboxedPath, options?: CsvOptions): Promise<LoadedDocument>;
  clear(): void;
  readonly size: number;
}

export function createDocumentCache(root?: string): DocumentCache {
  const store: DocumentStore<DocumentBody, CsvOptions> = createDocumentStore({
    maxEntries: limits.documentCacheSize,
    maxBytes: limits.maxFileBytes,
    maxBytesFor: (path) =>
      formats.formatFor(path) === "csv"
        ? limits.maxCsvBytes
        : limits.maxFileBytes,
    mode: modePolicy,
    ...(root === undefined ? {} : { root }),
    vocabulary,
    fail,
    variantKey,
    parse: parseDocument,
  });
  return {
    load: (path, options = {}) => store.load(path, options),
    clear: () => {
      store.clear();
    },
    get size() {
      return store.size;
    },
  };
}

const defaultCache = createDocumentCache();

export function clearDocumentCache(): void {
  defaultCache.clear();
}

export async function loadDocument(
  path: SandboxedPath,
  options: CsvOptions = {},
): Promise<LoadedDocument> {
  return defaultCache.load(path, options);
}

export function documentSheet(
  loaded: LoadedDocument,
  sheetName: string | undefined,
): SheetView {
  if (loaded.format === "csv") {
    if (sheetName !== undefined && sheetName !== csvSheetName) {
      throw new SkMcpExcelError(
        "unknown_sheet",
        `A CSV file has no sheet named '${sheetName}'.`,
        `Available sheets: ${csvSheetName}.`,
      );
    }
    return csvSheetView(loaded.table);
  }
  return xlsxSheetView(selectWorksheet(loaded.workbook, sheetName));
}

export function sheetSource(loaded: LoadedDocument): SheetSource {
  return {
    stamp: loaded.stamp,
    sheetFor: (sheetName) => documentSheet(loaded, sheetName),
  };
}

export function csvReportOf(loaded: LoadedDocument): CsvReport | undefined {
  return loaded.format === "csv" ? loaded.table.report : undefined;
}

export interface DocumentDescription extends WorkbookDescription {
  readonly format: DocumentFormat;
  readonly capabilities: (typeof capabilities)[DocumentFormat];
  readonly csv?: CsvReport;
}

export function describeDocument(
  loaded: LoadedDocument,
  meta: DocumentMeta,
  includeDefinedNames: boolean,
): DocumentDescription {
  const body =
    loaded.format === "csv"
      ? describeCsv(loaded.table, meta)
      : describeWorkbook(loaded.workbook, meta, includeDefinedNames);
  return {
    ...body,
    format: loaded.format,
    capabilities: capabilities[loaded.format],
    ...(loaded.format === "csv" ? { csv: loaded.table.report } : {}),
  };
}
