import { defineConfig } from "oxlint";
import { config } from "@liaiso/oxlint-config/base";
import { casing } from "@liaiso/oxlint-config/casing";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**"],
  overrides: [...casing],
});
