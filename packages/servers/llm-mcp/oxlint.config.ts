import { defineConfig } from "oxlint";
import { config } from "@liaiso/oxlint-config/base";
import {
  casingProperties,
  processEnvProperty,
  restrictProperties,
} from "@liaiso/oxlint-config/casing";

const platformMessage =
  "The platform layer is the mcp-core and node boundary; it may not import a layer above it.";
const backendMessage =
  "A backend talks to one model host; it never shapes an MCP response.";
const toolsMessage =
  "Tools see a model host only through backend/port.ts; the concrete backend is bound in cli.ts.";
const networkMessage =
  "Only src/backend/ollama.ts reaches the network, and only through the global fetch.";
const fsMessage =
  "Only src/platform/workspace.ts touches the filesystem: it is the one place that checks containment and the only writer.";

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

const fsModules = ["node:fs", "node:fs/promises", "fs", "fs/promises"];

/**
 * Guard: the entrypoints are listed alongside the folder globs because
 * no-restricted-imports matches the specifier string, not the resolved module.
 * Without them a layer could reach anything through ../index.js and the rule
 * would never fire.
 */
const entrypoints = ["**/index.js", "**/server.js", "**/cli.js"];

/**
 * Guard: the network and filesystem bans are folded into every layer's rule
 * because a later override replaces no-restricted-imports outright instead of
 * merging with it; a layer override without them would silently lift
 * the ban for its files.
 */
const restrict = (
  message: string,
  {
    paths = [],
    folders = [],
    fs = false,
  }: { paths?: string[]; folders?: string[]; fs?: boolean },
) => ({
  "no-restricted-imports": [
    "error",
    {
      paths: [
        ...networkModules.map((name) => ({ name, message: networkMessage })),
        ...(fs ? [] : fsModules.map((name) => ({ name, message: fsMessage }))),
        ...paths.map((name) => ({ name, message })),
      ],
      ...(folders.length === 0
        ? {}
        : { patterns: [{ group: [...folders, ...entrypoints], message }] }),
    },
  ],
});

const envMessage =
  "Configuration is read once in cli.ts and passed to a pure parser.";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**"],
  overrides: [
    {
      files: ["src/**/*.ts"],
      excludeFiles: ["src/backend/ollama.ts"],
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
      files: ["src/platform/workspace.ts"],
      rules: restrict(platformMessage, {
        paths: serverPackages,
        folders: ["**/backend/**", "**/tools/**"],
        fs: true,
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
      excludeFiles: ["src/cli.ts"],
      rules: restrictProperties(
        ...casingProperties,
        processEnvProperty(envMessage),
      ),
    },
    {
      files: ["src/cli.ts"],
      rules: restrictProperties(...casingProperties),
    },
  ],
});
