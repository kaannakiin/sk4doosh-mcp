import { defineConfig } from "oxlint";
import { config } from "@sk-mcp/oxlint-config/base";
import { chatApp, chatUntrustedHttp } from "@sk-mcp/oxlint-config/chat";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**", "src/codex/protocol/generated/**"],
  overrides: [...chatApp, ...chatUntrustedHttp],
});
