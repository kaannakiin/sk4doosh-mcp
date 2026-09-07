import type { FileHandle } from "node:fs/promises";
import ExcelJS from "exceljs";
import type { DataValidation, Workbook, Worksheet } from "exceljs";
import { SkMcpExcelError } from "./errors.js";
import { limits } from "./limits.js";
import { formatRange, type GridBounds } from "./range.js";
import { canonical } from "./unicode.js";

export interface DocumentMeta {
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
}

function mapXlsxError(error: unknown, path: string): SkMcpExcelError {
  if (error instanceof SkMcpExcelError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new SkMcpExcelError(
    "corrupt_workbook",
    `'${path}' could not be parsed as .xlsx: ${detail}`,
    "Open the file in Excel and re-save it as .xlsx.",
  );
}

export async function parseXlsx(
  handle: FileHandle,
  path: string,
): Promise<Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.read(
      handle.createReadStream({ start: 0, autoClose: false }),
    );
  } catch (error) {
    throw mapXlsxError(error, path);
  }
  if (workbook.properties === undefined) {
    throw new SkMcpExcelError(
      "corrupt_workbook",
      `'${path}' is a zip archive but carries no workbook part.`,
      "The file is probably not a spreadsheet; check what it really is before reading it.",
    );
  }
  return workbook;
}

export function sheetNameSummary(workbook: Workbook): string {
  return workbook.worksheets
    .map((sheet) =>
      sheet.state === "visible" ? sheet.name : `${sheet.name} (${sheet.state})`,
    )
    .join(", ");
}

export function selectWorksheet(
  workbook: Workbook,
  sheetName: string | undefined,
): Worksheet {
  if (sheetName === undefined) {
    const visible = workbook.worksheets.find(
      (sheet) => sheet.state === "visible",
    );
    const fallback = visible ?? workbook.worksheets[0];
    if (fallback === undefined) {
      throw new SkMcpExcelError(
        "unknown_sheet",
        "The workbook has no worksheets.",
      );
    }
    return fallback;
  }
  const wanted = canonical(sheetName);
  const found = workbook.worksheets.filter(
    (sheet) => canonical(sheet.name) === wanted,
  );
  if (found.length > 1) {
    throw new SkMcpExcelError(
      "ambiguous_sheet",
      `The workbook has ${found.length} sheets whose names normalise to '${sheetName}'.`,
      "Rename the sheets in the workbook; they cannot be addressed apart.",
    );
  }
  const only = found[0];
  if (only === undefined) {
    throw new SkMcpExcelError(
      "unknown_sheet",
      `The workbook has no sheet named '${sheetName}'.`,
      `Available sheets: ${sheetNameSummary(workbook)}.`,
    );
  }
  return only;
}

export function usedBounds(worksheet: Worksheet): GridBounds | undefined {
  if (worksheet.actualRowCount === 0) {
    return undefined;
  }
  const dimensions = worksheet.dimensions;
  return {
    top: dimensions.top,
    left: dimensions.left,
    bottom: dimensions.bottom,
    right: dimensions.right,
  };
}

export interface BoundedSheet {
  readonly name: string;
  readonly bounds: GridBounds | undefined;
}

export function requireSheetBounds(sheet: BoundedSheet): GridBounds {
  if (sheet.bounds === undefined) {
    throw new SkMcpExcelError(
      "empty_sheet",
      `Sheet '${sheet.name}' has no cells with values.`,
      "Call describe_workbook to see which sheets carry data.",
    );
  }
  return sheet.bounds;
}

export function requireBounds(worksheet: Worksheet): GridBounds {
  return requireSheetBounds({
    name: worksheet.name,
    bounds: usedBounds(worksheet),
  });
}

interface ValidationsHost {
  readonly dataValidations?: {
    readonly model?: Readonly<Record<string, DataValidation | undefined>>;
  };
}

export function validationsOf(
  worksheet: Worksheet,
): Readonly<Record<string, DataValidation | undefined>> {
  return (
    (worksheet as Worksheet & ValidationsHost).dataValidations?.model ?? {}
  );
}

export interface FormulaStats {
  readonly formulaCellCount: number;
  readonly cachedFormulaValueCount: number;
}

export function formulaStats(worksheet: Worksheet): FormulaStats {
  let formulaCellCount = 0;
  let cachedFormulaValueCount = 0;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.formula === undefined || cell.formula === "") {
        return;
      }
      formulaCellCount += 1;
      if (cell.result !== undefined) {
        cachedFormulaValueCount += 1;
      }
    });
  });
  return { formulaCellCount, cachedFormulaValueCount };
}

export interface SheetSummary {
  readonly name: string;
  readonly index: number;
  readonly state: string;
  readonly usedRange: string | null;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly declaredRowCount: number | null;
  readonly declaredColumnCount: number | null;
  readonly mergeCount: number | null;
  readonly dataValidationRuleCount: number | null;
  readonly formulaCellCount: number | null;
  readonly cachedFormulaValueCount: number | null;
}

export interface WorkbookDescription {
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly dateSystem: "1900" | "1904" | null;
  readonly sheets: readonly SheetSummary[];
  readonly definedNames?: readonly {
    readonly name: string;
    readonly ranges: readonly string[];
  }[];
  readonly guidance?: string;
}

export function describeWorkbook(
  workbook: Workbook,
  meta: DocumentMeta,
  includeDefinedNames: boolean,
): WorkbookDescription {
  const sheets = workbook.worksheets.map((worksheet, ordinal): SheetSummary => {
    const bounds = usedBounds(worksheet);
    const stats = formulaStats(worksheet);
    const validations = new Set(
      Object.values(validationsOf(worksheet))
        .filter((rule): rule is DataValidation => rule !== undefined)
        .map((rule) => JSON.stringify(rule)),
    );
    return {
      name: worksheet.name,
      index: ordinal + 1,
      state: worksheet.state,
      usedRange: bounds === undefined ? null : formatRange(bounds),
      rowCount: bounds === undefined ? 0 : bounds.bottom - bounds.top + 1,
      columnCount: bounds === undefined ? 0 : bounds.right - bounds.left + 1,
      declaredRowCount: worksheet.rowCount,
      declaredColumnCount: worksheet.columnCount,
      mergeCount: worksheet.model.merges.length,
      dataValidationRuleCount: validations.size,
      formulaCellCount: stats.formulaCellCount,
      cachedFormulaValueCount: stats.cachedFormulaValueCount,
    };
  });
  const tallest = sheets.reduce(
    (largest, sheet) => Math.max(largest, sheet.rowCount),
    0,
  );
  return {
    filePath: meta.filePath,
    sizeBytes: meta.sizeBytes,
    modifiedAt: meta.modifiedAt,
    dateSystem: workbook.properties.date1904 === true ? "1904" : "1900",
    sheets,
    ...(includeDefinedNames
      ? { definedNames: workbook.definedNames.model }
      : {}),
    ...(tallest > limits.guidanceRowThreshold
      ? {
          guidance: `The largest sheet has ${tallest} rows. Use aggregate_sheet for totals and rankings, find_in_sheet to locate a value, or read_sheet with a narrow range.`,
        }
      : {}),
  };
}
