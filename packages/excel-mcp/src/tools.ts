import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  guard as coreGuard,
  json,
  measureJson,
  readOnly,
  toolNamesOf,
  type ErrorContext,
  type GuardedHandler,
  type HandlersOf,
  type ToolDefinitions,
  type ToolInputOf,
  type SourceMode,
  type ToolNameOf,
} from "@sk-mcp/file-core";
import { z } from "zod";
import { asExcelError, fail, SkMcpExcelError } from "./errors.js";
import { formats } from "./formats.js";
import { limits, modePolicy } from "./limits.js";
import {
  listWorkbooks,
  resolveWorkbookPath,
  type WorkbookRoot,
} from "./paths.js";
import { findInSheet, readSheet } from "./read-sheet.js";
import { collectConditionalFormats } from "./conditional-formats.js";
import { collectImages } from "./images.js";
import { collectTables } from "./tables.js";
import { collectValidations } from "./validations.js";
import { selectSheetName } from "./sheetjs-workbook.js";
import {
  createDocumentCache,
  csvReportOf,
  describeDocument,
  documentSheet,
  sheetSource,
  type LoadedDocument,
} from "./document.js";
import { aggregateSheet } from "./aggregate.js";
import {
  declaredHeaderRow,
  scanHeaderRow,
  type HeaderRowSource,
} from "./header.js";
import { formatRange, resolveRange } from "./range.js";

import type { CsvReport, DelimiterName, EncodingName } from "./csv.js";
import { requireSheetBounds } from "./sheet.js";
import { inheritCursorOptions, decodeCursor } from "./cursor.js";

const modeEnvelopeBytes = measureJson({ mode: "resident" });

const filePath = z
  .string()
  .describe(
    "Workbook path relative to the server root, as returned by list_workbooks.",
  );
const sheetName = z
  .string()
  .optional()
  .describe(
    "Case-sensitive worksheet name with NFC equivalence; no case-insensitive fallback. Defaults to the first visible sheet. Unknown names return available names.",
  );
const columnRef = z
  .string()
  .describe(
    "Header text of the column, or its A1 letter such as C. Header text is matched case- and accent-insensitively.",
  );
const drawingKind = z
  .enum(["picture", "chart", "pivotTable", "sparkline"])
  .optional()
  .describe(
    "Drawing kind. Only 'picture' can be read; the other kinds are refused rather than reported as absent.",
  );

export const toolDefinitions = {
  list_workbooks: {
    description:
      "List readable .xlsx, .xlsm and .csv files under the server root. Returns filePath values that other tools accept verbatim. totalExact distinguishes complete totals; scanTruncated is separate from the result page limit.",
    inputSchema: z.object({
      subdirectory: z
        .string()
        .optional()
        .describe("Folder under the root to list."),
      pattern: z
        .string()
        .optional()
        .describe("Glob over the relative path, for example q1/*.xlsx."),
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
  describe_workbook: {
    description:
      "Summarise a workbook: sheets, used ranges, merge and validation counts, formula cache coverage and defined names. Call this before reading data.",
    inputSchema: z.object({
      filePath,
      includeDefinedNames: z
        .boolean()
        .optional()
        .describe(
          "Include the partial ExcelJS name list, default true. Sheet-local scopes may be missing; inspect limitations.",
        ),
      delimiter: z
        .enum(["comma", "semicolon", "tab", "pipe"])
        .optional()
        .describe("CSV field separator. Sniffed and echoed back when omitted."),
      encoding: z
        .enum([
          "utf-8",
          "utf-16le",
          "utf-16be",
          "windows-1254",
          "iso-8859-9",
          "windows-1252",
        ])
        .optional()
        .describe(
          "CSV text encoding. Detected from the byte-order mark, else utf-8.",
        ),
    }),
    annotations: readOnly,
  },
  read_sheet: {
    description:
      "Read a rectangular cell range as a compact grid: hoisted column headers plus row arrays. Pass nextCursor back to continue a truncated read.",
    inputSchema: z.object({
      filePath,
      sheetName,
      range: z
        .string()
        .optional()
        .describe(
          "A1 range such as B2:D40, B:D or 2:40. Defaults to the used range.",
        ),
      cursor: z
        .string()
        .optional()
        .describe(
          "Opaque v2 token from a previous response. Cannot be combined with sheetName or range. Omitted interpretation and CSV options are inherited; explicit values must match the first page. maxCells may change.",
        ),
      maxCells: z
        .int()
        .min(1)
        .max(limits.maxCellsHard)
        .optional()
        .describe(
          "Cells per response, default 2000. May change between cursor pages.",
        ),
      valueMode: z
        .enum(["values", "formulas", "both"])
        .optional()
        .describe(
          "Values, formulas, or values with formula notes; default values. Cursor-bound: conflicts are rejected. XLSX only.",
        ),
      mergedCells: z
        .enum(["master", "repeat"])
        .optional()
        .describe(
          "Master-only or repeated merged values, default master. Applies to headers too. Cursor-bound; XLSX only.",
        ),
      headerRow: z
        .int()
        .min(0)
        .optional()
        .describe(
          "Explicit header row. New reads default to 1; 0 disables headers. Cursor-bound: omit to inherit. Cannot be combined with headerScan=true.",
        ),
      headerScan: z
        .boolean()
        .optional()
        .describe(
          "Detect a provable header row, default false. Cannot be combined with headerRow on a new read. Cursor-bound: omit to inherit. Ambiguity fails rather than guessing.",
        ),
      includeHyperlinks: z
        .boolean()
        .optional()
        .describe(
          "Include hyperlink notes, default false. Cursor-bound; true requires XLSX.",
        ),
      delimiter: z
        .enum(["comma", "semicolon", "tab", "pipe"])
        .optional()
        .describe("CSV field separator. Sniffed and echoed back when omitted."),
      encoding: z
        .enum([
          "utf-8",
          "utf-16le",
          "utf-16be",
          "windows-1254",
          "iso-8859-9",
          "windows-1252",
        ])
        .optional()
        .describe(
          "CSV text encoding. Detected from the byte-order mark, else utf-8.",
        ),
    }),
    annotations: readOnly,
  },
  get_merged_ranges: {
    description: "List the merged cell ranges of a worksheet.",
    inputSchema: z.object({ filePath, sheetName }),
    annotations: readOnly,
  },
  get_data_validations: {
    description:
      "List the data validation rules of a worksheet, grouped back into rectangular ranges.",
    inputSchema: z.object({ filePath, sheetName }),
    annotations: readOnly,
  },

  get_tables: {
    description:
      "List the Excel Tables (ListObjects) a worksheet declares: range, header and totals rows, and column names with their A1 letters.",
    inputSchema: z.object({ filePath, sheetName }),
    annotations: readOnly,
  },

  get_conditional_formats: {
    description:
      "List the conditional formatting rules of a worksheet as predicates: target ranges, rule kind, operator, formulae and thresholds. Fill colours, icons and bar geometry are not reported.",
    inputSchema: z.object({ filePath, sheetName }),
    annotations: readOnly,
  },

  get_images: {
    description:
      "List the pictures embedded in a worksheet: anchor range, byte size and file extension. Charts, pivot tables and sparklines cannot be read and are refused rather than reported as absent.",
    inputSchema: z.object({ filePath, sheetName, kind: drawingKind }),
    annotations: readOnly,
  },
  aggregate_sheet: {
    description:
      "Group rows and compute totals, averages, extremes and counts over a sheet in one call. Use this instead of paging a large sheet. Columns are named by header text or by A1 letter.",
    inputSchema: z.object({
      filePath,
      sheetName,
      range: z.string().optional(),
      groupBy: z
        .array(columnRef)
        .max(limits.maxMetrics)
        .optional()
        .describe("Columns to group by. Omit for a single whole-range total."),
      metrics: z
        .array(
          z.object({
            fn: z.enum([
              "count",
              "countValues",
              "countDistinct",
              "sum",
              "avg",
              "min",
              "max",
              "stddev",
            ]),
            column: columnRef.optional(),
          }),
        )
        .min(1)
        .max(limits.maxMetrics),
      where: z
        .array(
          z.object({
            column: columnRef,
            op: z.enum([
              "eq",
              "ne",
              "lt",
              "lte",
              "gt",
              "gte",
              "contains",
              "startsWith",
              "endsWith",
              "in",
              "between",
              "isEmpty",
              "isNotEmpty",
              "isError",
              "isNumber",
              "isText",
            ]),
            value: z.union([z.string(), z.number(), z.boolean()]).optional(),
            values: z
              .array(z.union([z.string(), z.number(), z.boolean()]))
              .min(1)
              .max(limits.maxInValues)
              .optional(),
          }),
        )
        .max(limits.maxConditions)
        .optional()
        .describe(
          "Row filter. A cell of a different kind from the operand never matches and is counted as skipped.",
        ),
      match: z
        .enum(["all", "any"])
        .optional()
        .describe("Combine predicates with all (default) or any."),
      headerRow: z
        .int()
        .min(0)
        .optional()
        .describe(
          "Row treated as headers, never detected. Defaults to 1; 0 disables.",
        ),
      headerScan: z
        .boolean()
        .optional()
        .describe(
          "Prove the header row from the sheet instead of assuming row 1. Cannot be combined with headerRow. Fails rather than guessing.",
        ),
      columnMode: z
        .enum(["auto", "header", "letter"])
        .optional()
        .describe(
          "Automatic resolution (default), header text, or A1 letter. Letter mode ignores duplicate headers.",
        ),
      caseSensitive: z
        .boolean()
        .optional()
        .describe(
          "Case-sensitive text comparisons, default false. Applies to predicate bounds and min/max.",
        ),
      coerceText: z
        .boolean()
        .optional()
        .describe(
          'Treat numeric text such as "1234.50" as a number. Off by default.',
        ),
      mergedCells: z
        .enum(["master", "repeat"])
        .optional()
        .describe("Merged values and header detection policy, default master."),
      orderBy: z
        .enum(["group", "metric"])
        .optional()
        .describe("Sort by group key (default) or selected metric."),
      orderByMetric: z
        .int()
        .min(1)
        .max(limits.maxMetrics)
        .optional()
        .describe(
          "One-based index into metrics, default 1. Cannot exceed the actual metrics count.",
        ),
      descending: z
        .boolean()
        .optional()
        .describe("Descending sort, default false."),
      maxGroups: z
        .int()
        .min(1)
        .max(limits.maxGroupsHard)
        .optional()
        .describe(
          "Maximum groups returned, default 50. matchedRows covers all groups; metric counted/skipped covers returnedMatchedRows.",
        ),
    }),
    annotations: readOnly,
  },
  find_in_sheet: {
    description:
      "Find cells whose value or formula matches a query. Use this instead of paging a large sheet.",
    inputSchema: z.object({
      filePath,
      query: z.string().min(1),
      sheetName,
      matchMode: z
        .enum(["contains", "exact", "regex"])
        .optional()
        .describe(
          "Contains (default), exact text or JavaScript regex. Regex runs in an isolated worker with a two-second deadline.",
        ),
      caseSensitive: z
        .boolean()
        .optional()
        .describe(
          "Case-sensitive matching, default false. Literal search uses NFC/folding; regex retains JavaScript semantics.",
        ),
      searchIn: z
        .enum(["values", "formulas", "both"])
        .optional()
        .describe(
          "Search values (default), formulas or both. CSV supports values only.",
        ),
      range: z.string().optional(),
      maxResults: z
        .int()
        .min(1)
        .max(limits.maxFindResults)
        .optional()
        .describe(
          "Maximum returned matches, default 50. Does not increase the regex deadline.",
        ),
      delimiter: z
        .enum(["comma", "semicolon", "tab", "pipe"])
        .optional()
        .describe("CSV field separator. Sniffed and echoed back when omitted."),
      encoding: z
        .enum([
          "utf-8",
          "utf-16le",
          "utf-16be",
          "windows-1254",
          "iso-8859-9",
          "windows-1252",
        ])
        .optional()
        .describe(
          "CSV text encoding. Detected from the byte-order mark, else utf-8.",
        ),
    }),
    annotations: readOnly,
  },
} as const satisfies ToolDefinitions;

type Definitions = typeof toolDefinitions;

export type ToolName = ToolNameOf<Definitions>;

export const toolNames: readonly ToolName[] = toolNamesOf(toolDefinitions);

export type ToolInputSchema = Definitions[ToolName]["inputSchema"];

type ToolInput<K extends ToolName> = ToolInputOf<Definitions, K>;

export type ToolHandlers = HandlersOf<Definitions>;

export function guard<K extends ToolName>(
  context: ErrorContext & { readonly tool: K },
  handler: (
    args: ToolInput<K>,
    tool: K,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>,
): GuardedHandler<Definitions, K> {
  return coreGuard<Definitions, K>({ ...context, fail }, handler, asExcelError);
}

export function createHandlers(root: WorkbookRoot): ToolHandlers {
  const cache = createDocumentCache(root.real);
  const openFor = async (
    path: string,
    csv: { delimiter?: DelimiterName; encoding?: EncodingName } = {},
  ) => cache.load(await resolveWorkbookPath(root, path), csv);

  const openXlsx = async (path: string, tool: ToolName) => {
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

  const assertPictureKind = (kind: string | undefined) => {
    if (kind === undefined || kind === "picture") {
      return;
    }
    throw new SkMcpExcelError(
      "unsupported_object_kind",
      `get_images cannot read ${kind} objects; the reader never unzips xl/charts or xl/pivotCache, so an empty list would be a lie rather than an answer.`,
      "Call describe_workbook and read the capabilities block; charts, pivotTables and sparklines are false for every format.",
    );
  };

  const rejectForCsv = (
    loaded: LoadedDocument,
    field: string,
    value: unknown,
    filePath: string,
  ) => {
    if (loaded.format === "csv" && value !== undefined) {
      throw new SkMcpExcelError(
        "unsupported_for_format",
        `CSV files cannot carry that information; ${field} is not available for '${filePath}'.`,
        `Omit ${field}, or read an .xlsx file.`,
      );
    }
  };

  const assertHeaderScan = (
    args: {
      readonly headerScan?: boolean;
      readonly headerRow?: number;
      readonly cursor?: string;
    },
    path: string,
  ) => {
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
  };

  const resolveHeader = (
    loaded: LoadedDocument,
    args: {
      readonly headerScan?: boolean;
      readonly headerRow?: number;
      readonly sheetName?: string;
      readonly range?: string;
      readonly mergedCells?: "master" | "repeat";
    },
  ): { headerRow: number; headerRowSource: HeaderRowSource } => {
    if (args.headerScan !== true) {
      return {
        headerRow: args.headerRow ?? 1,
        headerRowSource: args.headerRow === undefined ? "default" : "explicit",
      };
    }
    const sheet = documentSheet(loaded, args.sheetName);
    const bounds = resolveRange(requireSheetBounds(sheet), args.range);
    const declared = declaredHeaderRow(
      sheet,
      bounds,
      args.mergedCells ?? "master",
    );
    if (declared !== undefined) {
      return { headerRow: declared.row, headerRowSource: "declared" };
    }
    return {
      headerRow: scanHeaderRow(
        sheet,
        bounds,
        args.mergedCells ?? "master",
        `${sheet.name}!${formatRange(bounds)}`,
      ),
      headerRowSource: "scanned",
    };
  };

  const withCsv = <T extends object>(
    payload: T,
    report: CsvReport | undefined,
    mode: SourceMode,
  ) =>
    report === undefined
      ? { ...payload, mode }
      : { ...payload, csv: report, mode };

  const withMode = <T extends object>(payload: T, mode: SourceMode) => ({
    ...payload,
    mode,
  });

  return {
    list_workbooks: guard(
      { root: root.real, tool: "list_workbooks" },
      async (args) => {
        const listing = await listWorkbooks(root, {
          ...(args.subdirectory === undefined
            ? {}
            : { subdirectory: args.subdirectory }),
          ...(args.pattern === undefined ? {} : { pattern: args.pattern }),
          maxResults: args.maxResults ?? limits.defaultListResults,
          mode: modePolicy,
        });
        return json({ root: root.real, ...listing });
      },
    ),

    describe_workbook: guard(
      { root: root.real, tool: "describe_workbook" },
      async (args) => {
        const loaded = await openFor(args.filePath, {
          ...(args.delimiter === undefined
            ? {}
            : { delimiter: args.delimiter }),
          ...(args.encoding === undefined ? {} : { encoding: args.encoding }),
        });
        return json(
          withMode(
            describeDocument(
              loaded,
              {
                filePath: args.filePath,
                sizeBytes: loaded.sizeBytes,
                modifiedAt: loaded.modifiedAt,
              },
              args.includeDefinedNames ?? true,
            ),
            loaded.mode,
          ),
        );
      },
    ),

    read_sheet: guard({ root: root.real, tool: "read_sheet" }, async (raw) => {
      const args = inheritCursorOptions(raw);
      const csvEnvelope = (report: CsvReport | undefined): number =>
        report === undefined ? 0 : measureJson({ csv: report });
      if (args.cursor === undefined) assertHeaderScan(args, args.filePath);
      const loaded = await openFor(args.filePath, {
        ...(args.delimiter === undefined ? {} : { delimiter: args.delimiter }),
        ...(args.encoding === undefined ? {} : { encoding: args.encoding }),
      });
      rejectForCsv(loaded, "valueMode", raw.valueMode, args.filePath);
      rejectForCsv(loaded, "mergedCells", raw.mergedCells, args.filePath);
      rejectForCsv(
        loaded,
        "includeHyperlinks",
        args.includeHyperlinks === true ? true : undefined,
        args.filePath,
      );
      const report = csvReportOf(loaded);
      return json(
        withCsv(
          readSheet(sheetSource(loaded), {
            extraEnvelopeBytes: csvEnvelope(report) + modeEnvelopeBytes,
            ...(args.sheetName === undefined
              ? {}
              : { sheetName: args.sheetName }),
            ...(args.range === undefined ? {} : { range: args.range }),
            ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
            maxCells: args.maxCells ?? limits.maxCellsDefault,
            valueMode: args.valueMode ?? "values",
            mergedCells: args.mergedCells ?? "master",
            ...(args.cursor === undefined
              ? resolveHeader(loaded, args)
              : {
                  headerRow: decodeCursor(args.cursor).h,
                  headerRowSource: "cursor" as const,
                }),
            headerScan: args.headerScan ?? false,
            ...(args.delimiter === undefined
              ? {}
              : { delimiter: args.delimiter }),
            ...(args.encoding === undefined ? {} : { encoding: args.encoding }),
            includeHyperlinks: args.includeHyperlinks ?? false,
          }),
          report,
          loaded.mode,
        ),
      );
    }),

    get_merged_ranges: guard(
      { root: root.real, tool: "get_merged_ranges" },
      async (args, tool) => {
        const loaded = await openXlsx(args.filePath, tool);
        const sheet = documentSheet(loaded, args.sheetName);
        const merges = sheet.merges;
        return json(
          withMode(
            { sheet: sheet.name, merges, count: merges.length },
            loaded.mode,
          ),
        );
      },
    ),

    get_data_validations: guard(
      { root: root.real, tool: "get_data_validations" },
      async (args, tool) => {
        const loaded = await openXlsx(args.filePath, tool);
        const sheet = selectSheetName(loaded.workbook, args.sheetName);
        return json(
          withMode(
            collectValidations(sheet, loaded.workbook.validations.get(sheet)),
            loaded.mode,
          ),
        );
      },
    ),

    get_tables: guard(
      { root: root.real, tool: "get_tables" },
      async (args, tool) => {
        const loaded = await openXlsx(args.filePath, tool);
        const sheet = selectSheetName(loaded.workbook, args.sheetName);
        return json(
          withMode(
            collectTables(sheet, loaded.workbook.tables.get(sheet) ?? []),
            loaded.mode,
          ),
        );
      },
    ),

    get_conditional_formats: guard(
      { root: root.real, tool: "get_conditional_formats" },
      async (args, tool) => {
        const loaded = await openXlsx(args.filePath, tool);
        const sheet = selectSheetName(loaded.workbook, args.sheetName);
        return json(
          withMode(
            collectConditionalFormats(
              sheet,
              loaded.workbook.conditionalFormats.get(sheet) ?? [],
            ),
            loaded.mode,
          ),
        );
      },
    ),

    get_images: guard(
      { root: root.real, tool: "get_images" },
      async (args, tool) => {
        assertPictureKind(args.kind);
        const loaded = await openXlsx(args.filePath, tool);
        const sheet = selectSheetName(loaded.workbook, args.sheetName);
        return json(
          withMode(
            collectImages(
              sheet,
              loaded.workbook.images.get(sheet) ?? [],
              loaded.workbook.media,
            ),
            loaded.mode,
          ),
        );
      },
    ),

    aggregate_sheet: guard(
      { root: root.real, tool: "aggregate_sheet" },
      async (args) => {
        assertHeaderScan(args, args.filePath);
        const loaded = await openFor(args.filePath);
        return json(
          withCsv(
            aggregateSheet(sheetSource(loaded), {
              ...(args.sheetName === undefined
                ? {}
                : { sheetName: args.sheetName }),
              ...(args.range === undefined ? {} : { range: args.range }),
              ...(args.groupBy === undefined ? {} : { groupBy: args.groupBy }),
              metrics: args.metrics,
              ...(args.where === undefined ? {} : { where: args.where }),
              match: args.match ?? "all",
              ...resolveHeader(loaded, args),
              columnMode: args.columnMode ?? "auto",
              caseSensitive: args.caseSensitive ?? false,
              coerceText: args.coerceText ?? false,
              mergedCells: args.mergedCells ?? "master",
              orderBy: args.orderBy ?? "group",
              ...(args.orderByMetric === undefined
                ? {}
                : { orderByMetric: args.orderByMetric }),
              descending: args.descending ?? false,
              maxGroups: args.maxGroups ?? limits.maxGroupsDefault,
            }),
            csvReportOf(loaded),
            loaded.mode,
          ),
        );
      },
    ),

    find_in_sheet: guard(
      { root: root.real, tool: "find_in_sheet" },
      async (args, _tool, signal) => {
        const loaded = await openFor(args.filePath, {
          ...(args.delimiter === undefined
            ? {}
            : { delimiter: args.delimiter }),
          ...(args.encoding === undefined ? {} : { encoding: args.encoding }),
        });
        rejectForCsv(
          loaded,
          "searchIn",
          args.searchIn === "values" ? undefined : args.searchIn,
          args.filePath,
        );
        return json(
          withCsv(
            await findInSheet(sheetSource(loaded), {
              ...(signal === undefined ? {} : { signal }),
              query: args.query,
              ...(args.sheetName === undefined
                ? {}
                : { sheetName: args.sheetName }),
              ...(args.range === undefined ? {} : { range: args.range }),
              matchMode: args.matchMode ?? "contains",
              caseSensitive: args.caseSensitive ?? false,
              searchIn: args.searchIn ?? "values",
              maxResults: args.maxResults ?? limits.defaultFindResults,
            }),
            csvReportOf(loaded),
            loaded.mode,
          ),
        );
      },
    ),
  };
}
