import { config } from "@sk-mcp/eslint-config/base";
import { casing } from "@sk-mcp/eslint-config/casing";

const gridLayer = [
  "src/aggregate.ts",
  "src/cell-value.ts",
  "src/columns.ts",
  "src/header.ts",
  "src/predicate.ts",
  "src/range.ts",
  "src/read-sheet.ts",
  "src/sheet.ts",
];

const formatAdapters = [
  "./conditional-formats.js",
  "./csv.js",
  "./document.js",
  "./images.js",
  "./tables.js",
  "./validations.js",
  "./workbook.js",
  "csv-parse",
  "csv-parse/sync",
  "exceljs",
];

export default [
  ...config,
  ...casing,
  { ignores: ["dist/**"] },
  {
    files: ["test/fixtures/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        performance: "readonly",
        AbortController: "readonly",
      },
    },
  },
  {
    files: gridLayer,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: formatAdapters.map((name) => ({
            name,
            message:
              "The grid layer sees sheets only through SheetView; it must not reach a format adapter.",
          })),
        },
      ],
    },
  },
];
