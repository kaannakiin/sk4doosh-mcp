import { SkMcpExcelError } from "./platform/errors.js";
import { formats } from "./platform/formats.js";
import { resolveWorkbookPath, type WorkbookRoot } from "./platform/paths.js";
import type {
  DocumentCache,
  LoadedDocument,
  LoadedWorkbook,
} from "./document.js";
import type { ToolName } from "./tools-definitions.js";

export type XlsxOpener = (
  path: string,
  tool: ToolName,
) => Promise<LoadedWorkbook>;

/**
 * Refuses a tool the document's format cannot answer, before the tool runs. The
 * opener closes over the root and the cache; every other gate here is free.
 */
export function createXlsxOpener(
  root: WorkbookRoot,
  cache: DocumentCache,
): XlsxOpener {
  return async (path, tool) => {
    const resolved = await resolveWorkbookPath(root, path);
    const format = formats.formatFor(resolved);
    if (format !== "xlsx") {
      throw new SkMcpExcelError(
        "unsupported_for_format",
        `${tool} is not available for ${format} files; the format cannot carry that information.`,
        "Call describe_workbook and read the capabilities block.",
      );
    }
    const loaded = await cache.load(resolved);
    if (loaded.format !== "xlsx") {
      throw new SkMcpExcelError(
        "unsupported_for_format",
        `${tool} needs a workbook.`,
      );
    }
    return loaded;
  };
}

export function assertPictureKind(kind: string | undefined): void {
  if (kind === undefined || kind === "picture") {
    return;
  }
  throw new SkMcpExcelError(
    "unsupported_object_kind",
    `get_images cannot read ${kind} objects; the reader never unzips xl/charts or xl/pivotCache, so an empty list would be a lie rather than an answer.`,
    "Call describe_workbook and read the capabilities block; charts, pivotTables and sparklines are false for every format.",
  );
}

export function rejectForCsv(
  loaded: LoadedDocument,
  field: string,
  value: unknown,
  filePath: string,
): void {
  if (loaded.format === "csv" && value !== undefined) {
    throw new SkMcpExcelError(
      "unsupported_for_format",
      `CSV files cannot carry that information; ${field} is not available for '${filePath}'.`,
      `Omit ${field}, or read an .xlsx file.`,
    );
  }
}

export function assertHeaderScan(
  args: {
    readonly headerScan?: boolean;
    readonly headerRow?: number;
    readonly cursor?: string;
  },
  path: string,
): void {
  if (args.headerScan !== true) {
    return;
  }
  if (args.headerRow !== undefined) {
    throw new SkMcpExcelError(
      "invalid_argument",
      "headerScan cannot be combined with headerRow.",
      "Pass headerScan to prove the header row, or headerRow to name it.",
    );
  }
  if (args.cursor !== undefined) {
    throw new SkMcpExcelError(
      "invalid_argument",
      "headerScan cannot be combined with cursor.",
      "The cursor already carries the header row resolved for the first page.",
    );
  }
  const format = formats.formatFor(path);
  if (format !== "xlsx") {
    throw new SkMcpExcelError(
      "unsupported_for_format",
      `headerScan is not available for ${format} files; every cell is text, so no row can be disqualified.`,
      "Pass headerRow explicitly for delimited files.",
    );
  }
}
