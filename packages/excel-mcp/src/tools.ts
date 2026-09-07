import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  guard as coreGuard,
  json,
  readOnly,
  toolNamesOf,
  type ErrorContext,
  type GuardedHandler,
  type HandlersOf,
  type ToolDefinitions,
  type ToolInputOf,
  type ToolNameOf,
} from "@sk-mcp/file-core";
import { z } from "zod";
import { asExcelError, SkMcpExcelError } from "./errors.js";
import { formats } from "./formats.js";
import { limits } from "./limits.js";
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
import { selectWorksheet } from "./workbook.js";

const filePath = z
  .string()
  .describe(
    "Workbook path relative to the server root, as returned by list_workbooks.",
  );
const sheetName = z
  .string()
  .optional()
  .describe("Worksheet name. Defaults to the first visible sheet.");
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
      "List readable .xlsx and .xlsm files under the server root. Returns filePath values that other tools accept verbatim.",
    inputSchema: z.object({
      subdirectory: z
        .string()
        .optional()
        .describe("Folder under the root to list."),
      pattern: z
        .string()
        .optional()
        .describe("Glob over the relative path, for example q1/*.xlsx."),
      maxResults: z.int().min(1).max(limits.maxListResults).optional(),
    }),
    annotations: readOnly,
  },
  describe_workbook: {
    description:
      "Summarise a workbook: sheets, used ranges, merge and validation counts, formula cache coverage and defined names. Call this before reading data.",
    inputSchema: z.object({
      filePath,
      includeDefinedNames: z.boolean().optional(),
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
          "Opaque token from a previous response. Cannot be combined with sheetName or range.",
        ),
      maxCells: z.int().min(1).max(limits.maxCellsHard).optional(),
      valueMode: z.enum(["values", "formulas", "both"]).optional(),
      mergedCells: z.enum(["master", "repeat"]).optional(),
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
      includeHyperlinks: z.boolean().optional(),
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
      match: z.enum(["all", "any"]).optional(),
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
      columnMode: z.enum(["auto", "header", "letter"]).optional(),
      caseSensitive: z.boolean().optional(),
      coerceText: z
        .boolean()
        .optional()
        .describe(
          'Treat numeric text such as "1234.50" as a number. Off by default.',
        ),
      mergedCells: z.enum(["master", "repeat"]).optional(),
      orderBy: z.enum(["group", "metric"]).optional(),
      orderByMetric: z.int().min(1).max(limits.maxMetrics).optional(),
      descending: z.boolean().optional(),
      maxGroups: z.int().min(1).max(limits.maxGroupsHard).optional(),
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
      matchMode: z.enum(["contains", "exact", "regex"]).optional(),
      caseSensitive: z.boolean().optional(),
      searchIn: z.enum(["values", "formulas", "both"]).optional(),
      range: z.string().optional(),
      maxResults: z.int().min(1).max(limits.maxFindResults).optional(),
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
  handler: (args: ToolInput<K>, tool: K) => Promise<CallToolResult>,
): GuardedHandler<Definitions, K> {
  return coreGuard<Definitions, K>(context, handler, asExcelError);
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
    const declared = declaredHeaderRow(sheet, bounds, "master");
    if (declared !== undefined) {
      return { headerRow: declared.row, headerRowSource: "declared" };
    }
    return {
      headerRow: scanHeaderRow(
        sheet,
        bounds,
        "master",
        `${sheet.name}!${formatRange(bounds)}`,
      ),
      headerRowSource: "scanned",
    };
  };

  const withCsv = <T extends object>(
    payload: T,
    report: CsvReport | undefined,
  ) => (report === undefined ? payload : { ...payload, csv: report });

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
          describeDocument(
            loaded,
            {
              filePath: args.filePath,
              sizeBytes: loaded.sizeBytes,
              modifiedAt: loaded.modifiedAt,
            },
            args.includeDefinedNames ?? true,
          ),
        );
      },
    ),

    read_sheet: guard({ root: root.real, tool: "read_sheet" }, async (args) => {
      assertHeaderScan(args, args.filePath);
      const loaded = await openFor(args.filePath, {
        ...(args.delimiter === undefined ? {} : { delimiter: args.delimiter }),
        ...(args.encoding === undefined ? {} : { encoding: args.encoding }),
      });
      rejectForCsv(loaded, "valueMode", args.valueMode, args.filePath);
      rejectForCsv(loaded, "mergedCells", args.mergedCells, args.filePath);
      rejectForCsv(
        loaded,
        "includeHyperlinks",
        args.includeHyperlinks === true ? true : undefined,
        args.filePath,
      );
      return json(
        withCsv(
          readSheet(sheetSource(loaded), {
            ...(args.sheetName === undefined
              ? {}
              : { sheetName: args.sheetName }),
            ...(args.range === undefined ? {} : { range: args.range }),
            ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
            maxCells: args.maxCells ?? limits.maxCellsDefault,
            valueMode: args.valueMode ?? "values",
            mergedCells: args.mergedCells ?? "master",
            ...resolveHeader(loaded, args),
            includeHyperlinks: args.includeHyperlinks ?? false,
          }),
          csvReportOf(loaded),
        ),
      );
    }),

    get_merged_ranges: guard(
      { root: root.real, tool: "get_merged_ranges" },
      async (args, tool) => {
        const loaded = await openXlsx(args.filePath, tool);
        const worksheet = selectWorksheet(loaded.workbook, args.sheetName);
        const merges = worksheet.model.merges;
        return json({ sheet: worksheet.name, merges, count: merges.length });
      },
    ),

    get_data_validations: guard(
      { root: root.real, tool: "get_data_validations" },
      async (args, tool) => {
        const loaded = await openXlsx(args.filePath, tool);
        const worksheet = selectWorksheet(loaded.workbook, args.sheetName);
        return json(collectValidations(worksheet));
      },
    ),

    get_tables: guard(
      { root: root.real, tool: "get_tables" },
      async (args, tool) => {
        const loaded = await openXlsx(args.filePath, tool);
        const worksheet = selectWorksheet(loaded.workbook, args.sheetName);
        return json(collectTables(worksheet));
      },
    ),

    get_conditional_formats: guard(
      { root: root.real, tool: "get_conditional_formats" },
      async (args, tool) => {
        const loaded = await openXlsx(args.filePath, tool);
        const worksheet = selectWorksheet(loaded.workbook, args.sheetName);
        return json(collectConditionalFormats(worksheet));
      },
    ),

    get_images: guard(
      { root: root.real, tool: "get_images" },
      async (args, tool) => {
        assertPictureKind(args.kind);
        const loaded = await openXlsx(args.filePath, tool);
        const worksheet = selectWorksheet(loaded.workbook, args.sheetName);
        return json(collectImages(loaded.workbook, worksheet));
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
          ),
        );
      },
    ),

    find_in_sheet: guard(
      { root: root.real, tool: "find_in_sheet" },
      async (args) => {
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
            findInSheet(sheetSource(loaded), {
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
          ),
        );
      },
    ),
  };
}
