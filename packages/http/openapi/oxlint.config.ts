import { defineConfig } from "oxlint";
import { config } from "@liaiso/oxlint-config/base";

const ioMessage =
  "Ingestion performs no I/O: a document and every external reference arrive through the injected DocumentLoader.";

const ioModules = [
  "node:http",
  "node:https",
  "node:net",
  "node:tls",
  "node:dgram",
  "node:fs",
  "node:fs/promises",
  "http",
  "https",
  "net",
  "tls",
  "fs",
  "fs/promises",
  "undici",
  "node-fetch",
  "axios",
];

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**"],
  overrides: [
    {
      files: ["src/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: ioModules.map((name) => ({ name, message: ioMessage })),
          },
        ],
        "no-restricted-globals": [
          "error",
          { name: "fetch", message: ioMessage },
          { name: "WebSocket", message: ioMessage },
          { name: "EventSource", message: ioMessage },
        ],
      },
    },
  ],
});
