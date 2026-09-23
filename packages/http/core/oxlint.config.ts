import { defineConfig } from "oxlint";
import { config } from "@sk-mcp/oxlint-config/base";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**", "src/generated/**"],
});
