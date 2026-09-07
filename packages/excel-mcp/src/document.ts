import { open } from "node:fs/promises";
import type { Workbook } from "exceljs";
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
import { fingerprint } from "./cursor.js";
import { SkMcpExcelError } from "./errors.js";
import { limits } from "./limits.js";
import {
  assertReadableFormat,
  formatFor,
  type DocumentFormat,
  type SandboxedPath,
} from "./paths.js";
import { xlsxSheetView, type SheetView } from "./sheet.js";
import {
  describeWorkbook,
  parseXlsx,
  selectWorksheet,
  type DocumentMeta,
  type WorkbookDescription,
} from "./workbook.js";

interface LoadedBase {
  readonly stamp: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
}

export interface LoadedWorkbook extends LoadedBase {
  readonly format: "xlsx";
  readonly workbook: Workbook;
}

export interface LoadedCsv extends LoadedBase {
  readonly format: "csv";
  readonly table: CsvTable;
}

export type LoadedDocument = LoadedWorkbook | LoadedCsv;

const cache = new Map<string, LoadedDocument>();

export function clearDocumentCache(): void {
  cache.clear();
}

function remember(key: string, document: LoadedDocument): LoadedDocument {
  cache.delete(key);
  cache.set(key, document);
  while (cache.size > limits.documentCacheSize) {
    const oldest = cache.keys().next();
    if (oldest.done === true) {
      break;
    }
    cache.delete(oldest.value);
  }
  return document;
}

function cacheKey(
  path: string,
  format: DocumentFormat,
  options: CsvOptions,
): string {
  if (format !== "csv") {
    return path;
  }
  return `${path}\u0000${options.delimiter ?? ""}\u0000${options.encoding ?? ""}`;
}

export async function loadDocument(
  path: SandboxedPath,
  options: CsvOptions = {},
): Promise<LoadedDocument> {
  const format = formatFor(path);
  const key = cacheKey(path, format, options);
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new SkMcpExcelError(
        "not_a_file",
        `'${path}' is not a regular file.`,
      );
    }
    if (info.size > limits.maxFileBytes) {
      throw new SkMcpExcelError(
        "file_too_large",
        `The file is ${info.size} bytes; the limit is ${limits.maxFileBytes}.`,
        "Split the workbook or read a smaller file.",
      );
    }
    const stamp = fingerprint(path, info.mtimeMs, info.size);
    const cached = cache.get(key);
    if (cached !== undefined && cached.stamp === stamp) {
      return remember(key, cached);
    }
    const base = {
      stamp,
      sizeBytes: info.size,
      modifiedAt: new Date(info.mtimeMs).toISOString(),
    };
    if (format === "csv") {
      const table = await parseCsv(handle, info.size, options, path);
      return remember(key, { format, table, ...base });
    }
    const magic = Buffer.alloc(8);
    await handle.read(magic, 0, 8, 0);
    assertReadableFormat(magic, path);
    const workbook = await parseXlsx(handle, path);
    return remember(key, { format, workbook, ...base });
  } finally {
    await handle.close();
  }
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
