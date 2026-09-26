import { defineConfig } from "oxlint";
import { config } from "@liaiso/oxlint-config/base";
import {
  casingProperties,
  processEnvProperty,
  restrictProperties,
} from "@liaiso/oxlint-config/casing";

const networkMessage =
  "Only src/net/fetch.ts reaches the network: it is the one place the host allowlist, the manual redirect and the byte cap are applied. src/transport/http.ts may import node:http to listen, never to call out.";
const fsMessage =
  "Only src/platform/files.ts touches the filesystem: it is the one place a referenced file is checked against the document's directory.";
const envMessage =
  "Configuration is read once in cli.ts and passed to a pure parser.";

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
 * Guard: the network ban is folded into the filesystem exception's rule because a later override
 * replaces no-restricted-imports outright instead of merging with it; an exception without it would
 * silently lift the network ban for that file.
 */
const restrict = (allowFs: boolean, allowServer = false) => ({
  "no-restricted-imports": [
    "error",
    {
      paths: [
        ...networkModules
          .filter((name) => !allowServer || name !== "node:http")
          .map((name) => ({ name, message: networkMessage })),
        ...(allowFs
          ? []
          : fsModules.map((name) => ({ name, message: fsMessage }))),
      ],
    },
  ],
});

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**"],
  overrides: [
    {
      files: ["src/**/*.ts"],
      excludeFiles: ["src/net/fetch.ts"],
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
      rules: restrict(false),
    },
    {
      files: ["src/platform/files.ts"],
      rules: restrict(true),
    },
    {
      files: ["src/transport/http.ts"],
      rules: restrict(false, true),
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
