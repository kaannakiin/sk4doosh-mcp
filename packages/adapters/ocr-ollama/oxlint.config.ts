import { defineConfig } from "oxlint";
import { config } from "@sk-mcp/oxlint-config/base";
import { casing } from "@sk-mcp/oxlint-config/casing";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**"],
  overrides: [...casing],
});
