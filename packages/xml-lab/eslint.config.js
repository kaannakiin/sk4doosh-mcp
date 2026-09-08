import { config } from "@sk-mcp/eslint-config/base";

export default [
  ...config,
  { ignores: ["local/**"] },
  {
    files: ["test/probes/**/*.mjs", "src/**/*.mjs", "collect-evidence.mjs"],
    languageOptions: {
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
  },
];
