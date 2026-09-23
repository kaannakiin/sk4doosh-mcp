import { config } from "@sk-mcp/eslint-config/base";
import { casing } from "@sk-mcp/eslint-config/casing";

const platformMessage =
  "The platform layer is the mcp-core and node boundary; it may not import a layer above it.";
const backendMessage =
  "A backend talks to one model host; it never shapes an MCP response.";
const toolsMessage =
  "Tools see a model host only through backend/port.ts; the concrete backend is bound in cli.ts.";
const networkMessage =
  "Only src/backend/ollama.ts reaches the network, and only through the global fetch.";

const serverPackages = ["@modelcontextprotocol/server"];

const networkModules = [
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:dgram",
  "http",
  "https",
  "net",
  "tls",
  "undici",
  "node-fetch",
  "axios",
];

/**
 * Guard: the entrypoints are listed alongside the folder globs because
 * no-restricted-imports matches the specifier string, not the resolved module.
 * Without them a layer could reach anything through ../index.js and the rule
 * would never fire.
 */
const entrypoints = ["**/index.js", "**/server.js", "**/cli.js"];

/**
 * Guard: the network ban is folded into every layer's rule because a later
 * flat-config block replaces no-restricted-imports outright instead of merging
 * with it; a layer block without it would silently lift the ban for its files.
 */
const restrict = (message, { paths = [], folders = [] }) => ({
  "no-restricted-imports": [
    "error",
    {
      paths: [
        ...networkModules.map((name) => ({ name, message: networkMessage })),
        ...paths.map((name) => ({ name, message })),
      ],
      ...(folders.length === 0
        ? {}
        : { patterns: [{ group: [...folders, ...entrypoints], message }] }),
    },
  ],
});

export default [
  ...config,
  ...casing,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/backend/ollama.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: networkMessage },
        { name: "WebSocket", message: networkMessage },
        { name: "EventSource", message: networkMessage },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: restrict(networkMessage, {}),
  },
  {
    files: ["src/platform/**/*.ts"],
    rules: restrict(platformMessage, {
      paths: serverPackages,
      folders: ["**/backend/**", "**/tools/**"],
    }),
  },
  {
    files: ["src/backend/**/*.ts"],
    rules: restrict(backendMessage, {
      paths: serverPackages,
      folders: ["**/tools/**"],
    }),
  },
  {
    files: ["src/tools/**/*.ts"],
    rules: restrict(toolsMessage, {
      folders: ["**/backend/ollama.js", "**/backend/serial.js"],
    }),
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
