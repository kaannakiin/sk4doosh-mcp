import { canonical } from "@sk-mcp/file-core";
import ExcelJS from "exceljs";
import type { DataValidation, Workbook, Worksheet } from "exceljs";
import { conditionalFormatRuleCountOf } from "./conditional-formats.js";
import { SkMcpExcelError } from "./errors.js";
import { imageCountOf } from "./images.js";
import { limits } from "./limits.js";
import {
  metadataLimitations,
  type MetadataLimitation,
} from "./metadata-support.js";
import { formatRange, type GridBounds } from "./range.js";
import { autoFilterRefOf, declaredTablesOf, tableCountOf } from "./tables.js";
import { requireSheetBounds, type SheetView } from "./sheet.js";
import { xlsxSnapshot } from "./xlsx-cell.js";

export interface DocumentMeta {
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
}

function mapXlsxError(error: unknown, path: string): SkMcpExcelError {
  if (error instanceof SkMcpExcelError) {
    return error;
  }
  return new SkMcpExcelError(
    "corrupt_workbook",
    `'${path}' could not be parsed as .xlsx.`,
    "Open the file in Excel and re-save it as .xlsx.",
  );
}

export async function parseXlsx(
  bytes: Buffer,
  path: string,
): Promise<Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
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

export function xlsxSheetView(worksheet: Worksheet): SheetView {
  return {
    name: worksheet.name,
    bounds: usedBounds(worksheet),
    merges: worksheet.model.merges,
    tables: declaredTablesOf(worksheet),
    autoFilter: autoFilterRefOf(worksheet),
    rowAt(row) {
      const found = worksheet.findRow(row);
      if (found === undefined) {
        return undefined;
      }
      return {
        cellAt(column) {
          const cell = found.findCell(column);
          if (cell === undefined) {
            return undefined;
          }
          return xlsxSnapshot({
            type: cell.type,
            value: cell.value,
            formula: cell.formula,
            result: cell.result,
            numberFormat: cell.numFmt,
          });
        },
      };
    },
  };
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

export interface FrozenPanes {
  readonly rows: number;
  readonly columns: number;
}

interface StoredView {
  readonly state?: string;
  readonly xSplit?: number;
  readonly ySplit?: number;
}

export function frozenPanesOf(worksheet: Worksheet): FrozenPanes {
  const views = (worksheet.views ?? []) as unknown as readonly StoredView[];
  const frozen = views.find((view) => view.state === "frozen");
  return {
    rows: frozen?.ySplit ?? 0,
    columns: frozen?.xSplit ?? 0,
  };
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
  readonly dataValidationRuleCountExact: boolean;
  readonly formulaCellCount: number | null;
  readonly cachedFormulaValueCount: number | null;
  readonly tableCount: number | null;
  readonly conditionalFormatRuleCount: number | null;
  readonly imageCount: number | null;
  readonly imageCountExact: boolean;
  readonly autoFilterRef: string | null;
  readonly frozenRowCount: number | null;
  readonly frozenColumnCount: number | null;
}

export interface WorkbookDescription {
  readonly limitations?: readonly MetadataLimitation[];
  readonly definedNamesComplete?: false;
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

const validationCounts = new WeakMap<
  Worksheet,
  { readonly count: number | null; readonly exact: boolean }
>();
function validationCount(worksheet: Worksheet): {
  readonly count: number | null;
  readonly exact: boolean;
} {
  const cached = validationCounts.get(worksheet);
  if (cached !== undefined) return cached;
  const rules = validationsOf(worksheet);
  const unique = new Set<string>();
  let visited = 0;
  for (const key in rules) {
    if (!Object.hasOwn(rules, key)) continue;
    if (visited >= limits.maxValidationCountEntries) {
      const result = { count: null, exact: false };
      validationCounts.set(worksheet, result);
      return result;
    }
    visited += 1;
    const rule = rules[key];
    if (rule !== undefined) unique.add(JSON.stringify(rule));
  }
  const result = { count: unique.size, exact: true };
  validationCounts.set(worksheet, result);
  return result;
}

export function describeWorkbook(
  workbook: Workbook,
  meta: DocumentMeta,
  includeDefinedNames: boolean,
): WorkbookDescription {
  const sheets = workbook.worksheets.map((worksheet, ordinal): SheetSummary => {
    const bounds = usedBounds(worksheet);
    const stats = formulaStats(worksheet);
    const panes = frozenPanesOf(worksheet);
    const validations = validationCount(worksheet);
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
      dataValidationRuleCount: validations.count,
      dataValidationRuleCountExact: validations.exact,
      formulaCellCount: stats.formulaCellCount,
      cachedFormulaValueCount: stats.cachedFormulaValueCount,
      tableCount: tableCountOf(worksheet),
      conditionalFormatRuleCount: conditionalFormatRuleCountOf(worksheet),
      imageCount: imageCountOf(worksheet),
      imageCountExact: false,
      autoFilterRef: autoFilterRefOf(worksheet) ?? null,
      frozenRowCount: panes.rows,
      frozenColumnCount: panes.columns,
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
    limitations: [
      metadataLimitations.images,
      metadataLimitations.thresholds,
      ...(includeDefinedNames ? [metadataLimitations.definedNames] : []),
    ],
    ...(includeDefinedNames
      ? {
          definedNames: workbook.definedNames.model,
          definedNamesComplete: false as const,
        }
      : {}),
    ...(tallest > limits.guidanceRowThreshold
      ? {
          guidance: `The largest sheet has ${tallest} rows. Use aggregate_sheet for totals and rankings, find_in_sheet to locate a value, or read_sheet with a narrow range.`,
        }
      : {}),
  };
}
