import { defineConfig } from "oxlint";
import { config } from "@liaiso/oxlint-config/base";
import { chatApp, chatUntrustedHttp } from "@liaiso/oxlint-config/chat";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**", "src/codex/protocol/generated/**"],
  overrides: [...chatApp, ...chatUntrustedHttp],
});
