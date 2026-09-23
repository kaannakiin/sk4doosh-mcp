import { defineConfig } from "oxlint";
import { config } from "@sk-mcp/oxlint-config/base";
import { casing } from "@sk-mcp/oxlint-config/casing";

const workerEntry = ["src/xml-worker.ts"];

const message =
  "The worker entry stays free of the host surface; it answers with a code string and the main side builds the error.";

const hostPackages = [
  "@sk-mcp/file-core",
  "@modelcontextprotocol/server",
  "zod",
];

const hostRootModules = [
  "./index.js",
  "./server.js",
  "./document.js",
  "./cli.js",
];

const hostFolders = ["**/host/**", "**/tools/**"];

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**"],
  overrides: [
    ...casing,
    {
      files: workerEntry,
      rules: {
        "no-console": "error",
        "no-restricted-imports": [
          "error",
          {
            paths: [...hostPackages, ...hostRootModules].map((name) => ({
              name,
              message,
            })),
            patterns: [{ group: hostFolders, message }],
          },
        ],
      },
    },
    {
      files: ["test/fixtures/*.mjs"],
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
      },
    },
  ],
});
