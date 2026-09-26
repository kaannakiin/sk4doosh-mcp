import { defineConfig } from "oxlint";
import { config } from "@liaiso/oxlint-config/base";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**", "local/**"],
  overrides: [
    {
      files: ["test/probes/**/*.mjs", "src/**/*.mjs", "collect-evidence.mjs"],
      globals: {
        AbortController: "readonly",
        Buffer: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        URL: "readonly",
        console: "readonly",
        fetch: "readonly",
        global: "readonly",
        performance: "readonly",
        process: "readonly",
        clearTimeout: "readonly",
        setTimeout: "readonly",
      },
    },
  ],
});
