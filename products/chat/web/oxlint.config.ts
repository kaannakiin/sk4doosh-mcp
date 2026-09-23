import { defineConfig } from "oxlint";
import { config } from "@sk-mcp/oxlint-config/react";
import { chatApp } from "@sk-mcp/oxlint-config/chat";

export default defineConfig({
  extends: [config],
  ignorePatterns: [".tanstack/**", "dist/**", "src/routeTree.gen.ts"],
  overrides: [...chatApp],
});
