import { defineConfig } from "oxlint";
import { config } from "@liaiso/oxlint-config/base";
import { chat } from "@liaiso/oxlint-config/chat";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**"],
  overrides: [...chat],
});
