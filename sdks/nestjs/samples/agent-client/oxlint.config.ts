import { defineConfig } from "oxlint";
import { config } from "@liaiso/oxlint-config/base";

export default defineConfig({
  extends: [config],
  ignorePatterns: ["dist/**"],
});
