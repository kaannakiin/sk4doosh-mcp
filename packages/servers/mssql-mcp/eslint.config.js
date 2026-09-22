import { config } from "@sk-mcp/eslint-config/base";
import { casing } from "@sk-mcp/eslint-config/casing";

const platformMessage =
  "The platform layer is the db-core and node boundary; it may not import a layer above it.";
const dialectMessage =
  "A dialect is portable T-SQL knowledge; it never names a driver and never reaches the MCP surface.";
const driverMessage =
  "The driver adapter opens sockets and streams rows; it never builds SQL and never shapes a response.";

const driverPackages = ["mssql", "tedious"];
const serverPackages = ["@modelcontextprotocol/server"];

/**
 * Guard: the entrypoints are listed alongside the folder globs because
 * no-restricted-imports matches the specifier string, not the resolved module.
 * Without them a layer could reach anything through ../index.js and the rule
 * would never fire.
 */
const entrypoints = ["**/index.js", "**/server.js", "**/cli.js"];

const restrict = (message, { paths = [], folders = [] }) => ({
  "no-restricted-imports": [
    "error",
    {
      paths: paths.map((name) => ({ name, message })),
      patterns: [{ group: [...folders, ...entrypoints], message }],
    },
  ],
});

export default [
  ...config,
  ...casing,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/dialect/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@sk-mcp/db-core",
              importNames: ["sqlText", "quotedIdentifier"],
              message:
                "Minting SqlText or a QuotedIdentifier belongs to the dialect layer; everywhere else they arrive already built.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/platform/**/*.ts"],
    rules: restrict(platformMessage, {
      paths: [...driverPackages, ...serverPackages],
      folders: ["**/dialect/**", "**/driver/**"],
    }),
  },
  {
    files: ["src/dialect/**/*.ts"],
    rules: restrict(dialectMessage, {
      paths: [...driverPackages, ...serverPackages],
      folders: ["**/driver/**"],
    }),
  },
  {
    files: ["src/driver/**/*.ts"],
    rules: restrict(driverMessage, { paths: serverPackages }),
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/cli.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Configuration is read once in cli.ts and passed to a pure parser.",
        },
      ],
    },
  },
  { ignores: ["dist/**"] },
];
