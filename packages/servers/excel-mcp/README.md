# @liaiso/excel-mcp

A standalone MCP server that **reads** local Excel files for an agent. There is no write path.

Reads `.xlsx`, `.xlsm` and `.csv`. Sandboxing, the document cache, the error envelope, the cursor codec and the tool registration layer come from [@liaiso/file-core](../../cores/file-core).

Cells, ranges, merges, formulas and defined names are read by SheetJS. Data validation, Excel Tables, conditional formatting, images and frozen panes are read directly from the OOXML parts. exceljs is not present at runtime.

## Quick start

The server takes the folder it is allowed to read as a **required argument**. Nothing outside that folder can be read.

```json
{
  "mcpServers": {
    "excel": {
      "command": "npx",
      "args": ["-y", "@liaiso/excel-mcp", "/Users/me/sheets"]
    }
  }
}
```

To run it from inside the repo:

```bash
pnpm turbo run build --filter=@liaiso/excel-mcp
node packages/servers/excel-mcp/dist/cli.js /Users/me/sheets
```

To try it with the Inspector:

```bash
npx @modelcontextprotocol/inspector node packages/servers/excel-mcp/dist/cli.js /Users/me/sheets
```

## Tools

| Tool                      | What it does                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `list_workbooks`          | Lists readable files under the root. The `filePath` it returns is passed to other tools verbatim             |
| `describe_workbook`       | Sheets, used range, merge/validation counts, formula cache coverage, defined names                           |
| `read_sheet`              | Reads a cell range as a compact grid: hoisted column headers plus row arrays                                 |
| `get_merged_ranges`       | Merged cell ranges                                                                                           |
| `get_data_validations`    | Validation rules, regrouped back into rectangular ranges                                                     |
| `get_tables`              | Excel Tables the sheet defines: range, header/totals row, column names and A1 letters                        |
| `get_conditional_formats` | Conditional formatting rules as predicates: target ranges, rule type, operator, formulas, thresholds         |
| `get_images`              | Images embedded in the sheet: anchor range, byte size, extension. Charts/pivot tables/sparklines are refused |
| `aggregate_sheet`         | Server-side count/sum/average and grouping; replaces paging `read_sheet` on a large sheet                    |
| `find_in_sheet`           | Searches cells by value or formula                                                                           |

Prefer `aggregate_sheet`, `find_in_sheet` or a narrow `range` over paging a large sheet with `read_sheet`; `describe_workbook` and `read_sheet` say so through their `guidance`/`hint` fields.

## Header row

`mergedCells` also affects the header row. Under the default `master`, only the first column of a merged cell carries the header; under `repeat`, every column the merge spans gets the same header. In a two-row header, the first column is often merged vertically (`A1:A2`), and that header can only be addressed by name under `repeat`. A horizontal group label (`B1:C1`) gives the same name to multiple columns under `repeat` and returns `ambiguous_column` — address it by letter instead.

`headerRow` is **never inferred on its own**; if it is not given, it is 1. Every response says who picked the row through `headerRowSource`: `"explicit"` (you provided it), `"declared"` (an Excel Table or autofilter on the sheet declared it), `"scanned"` (proven by `headerScan`), `"default"` (nobody picked it, 1 was assumed), `"cursor"` (came from a pagination token).

Excel often leaves a table's header row **implicit**: it never writes the `headerRowCount` attribute, and per spec its absence means "there is a header". `"declared"` recognizes this case too — if the column names the table declares match the cells in the first row of the table range, the header row counts as proven. If the names only partially match, nothing is asserted and the flow falls through to `headerScan`'s proof rules.

A merged header band, a blank row and the real header underneath are common in Excel output, and the default `headerRow: 1` silently miscounts there. There are two defenses: the response names the real header row through `warnings` when this happens, and `headerScan: true` proves the row in one call. When `headerScan` cannot prove it, it **does not guess**: with no candidate it returns `unknown_header_row`, with more than one candidate `ambiguous_header_row`, and `recovery` writes out the candidate rows' text. `headerScan` cannot be combined with `headerRow` or `cursor`, and returns `unsupported_for_format` on CSV.

## CSV

Values are **never interpreted**: `01234` stays a string, `03-04-2024` is not converted to a date, `true` does not become a boolean. The delimiter is sniffed and echoed on every response through `csv.delimiter` + `csv.delimiterSource`; when two candidates tie, `ambiguous_delimiter` is returned and you need the `delimiter` parameter. Encoding is resolved from a BOM, falling back to utf-8; for Turkish Excel output pass `encoding: "windows-1254"`.

Explicitly requesting something CSV cannot carry (`valueMode`, `mergedCells: "repeat"`, `includeHyperlinks`, `get_merged_ranges`, `get_data_validations`, `get_tables`, `get_conditional_formats`, `get_images`) returns `unsupported_for_format` — not an empty result. `describe_workbook` announces which capabilities are available up front in its `capabilities` block.

Charts, pivot tables and sparklines cannot be read **in any format** — this is not a CSV limitation but the reader's ceiling: exceljs never opens `xl/charts/*.xml`, has no object model for pivots, and sparklines are not recognized in the worksheet `extLst`. `get_images` returns `unsupported_object_kind` when these kinds are explicitly requested, and the `capabilities` block reports all three as `false` in both formats.

## Rich metadata

`get_data_validations`, `get_tables`, `get_conditional_formats` and `get_images` read OOXML parts namespace-aware with `saxes`. Matching is done on `(namespace uri, local name)` — the prefix the file happens to write is never consulted — so `<x:dataValidation>` and `<dataValidation>` are indistinguishable at the call site. Result: these tools work with any OPC layout, including prefixed .NET output and a worksheet part named `sheet.xml`.

What is read, and from where:

| tool                      | source                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_data_validations`    | worksheet part, `dataValidations/dataValidation`. Ranges are taken verbatim from `sqref`, not opened cell by cell — a rule covering an entire column still counts as exact, so `dataValidationRuleCountExact` is always `true`                                     |
| `get_tables`              | worksheet `tableParts` → sheet rels → `xl/tables/*.xml`. `filterButton` is matched by `colId`, not by position                                                                                                                                                     |
| `get_conditional_formats` | worksheet `conditionalFormatting/cfRule`. The `containsText` family is parsed into type + operator. A `cfvo type="formula"` threshold's expression is preserved in the `formula` field                                                                             |
| `get_images`              | worksheet `drawing` → sheet rels → `xl/drawings/*.xml` → `a:blip r:embed` → drawing rels → `xl/media/*`. `twoCell`, `oneCell` and `absolute` anchors are all reported; an absolute anchor has no cell range, and the `range` field is omitted rather than invented |

Charts, pivot tables and sparklines still cannot be read — the `capabilities` block reports all three as `false` in every format, and `get_images` returns `unsupported_object_kind` when these kinds are explicitly requested.

## Search and matching

With `caseSensitive` off, matching is case- **and accent-**insensitive: a query for `istanbul` finds `İSTANBUL`, and `sisli` finds `ŞİŞLİ`. Folding is language-independent; there is no Turkish-specific table. `regex` mode does not fold.

## Limits

Fixed, not configurable: file 50 MB (CSV 16 MB, 2M cells) · response 10,000 cells (default 2,000) · 512 KB serialized · 512 characters per cell · 50 groups in an aggregation (200 max returned; the scan itself tracks up to 100,000 groups). A truncated response carries `truncated`, `truncationReason` and `nextCursor`; `nextCursor` is passed straight back into `read_sheet`.

## Errors

Errors return with `isError: true` and a `{error, message, recovery}` body. `error` is a machine-readable code; `recovery` says how to fix the next call.

A corrupt-file claim is split into three separate codes, and none of them substitutes for another:

| code                 | when                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `not_a_workbook`     | the byte stream does not start with a zip header, or it is a valid zip with no workbook part inside (a `.docx` renamed to `.xlsx`) |
| `encrypted_workbook` | an OLE2/CFB header — password-protected, or the legacy binary format                                                               |
| `corrupt_workbook`   | the zip is valid, the workbook part exists, but the parser could not resolve it. The message carries the parser's own explanation  |

An unclassifiable failure caused by a defect in the server itself returns `internal_error` and **carries no `recovery`** — there is no known "next call", and pretending there is one sends the agent off to repair a file that is actually fine. The raw detail is written to stderr.

## Development

```bash
pnpm turbo run build --filter=@liaiso/excel-mcp
pnpm turbo run test --filter=@liaiso/excel-mcp
pnpm turbo run check-types --filter=@liaiso/excel-mcp
```

Run tests through Turbo, not `pnpm --filter @liaiso/excel-mcp test`: the bare filter skips `dependsOn: ["^build"]`, and this package resolves `@liaiso/file-core` through `exports.default → ./dist/index.js`, so a bare filter can test against a stale `dist`.
