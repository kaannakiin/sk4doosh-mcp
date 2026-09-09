import { config } from "@sk-mcp/eslint-config/base";
import { casing } from "@sk-mcp/eslint-config/casing";

const workerEntry = ["src/xml-worker.ts"];

const outsideWorker = [
  "@sk-mcp/file-core",
  "@modelcontextprotocol/sdk",
  "zod",
  "./errors.js",
  "./limits.js",
  "./paths.js",
  "./tools.js",
];

export default [
  ...config,
  ...casing,
  {
    files: workerEntry,
    rules: {
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: outsideWorker.map((name) => ({
            name,
            message:
              "The worker entry stays free of the host surface; it answers with a code string and the main side builds the error.",
          })),
        },
      ],
    },
  },
  {
    files: ["test/fixtures/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  { ignores: ["dist/**"] },
];
