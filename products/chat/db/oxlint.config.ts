import { defineConfig } from "oxlint";
import { config } from "@sk-mcp/oxlint-config/base";
import { chat } from "@sk-mcp/oxlint-config/chat";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**", "src/generated/**"],
  overrides: [...chat],
});
