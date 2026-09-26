import { defineConfig } from "oxlint";
import { config } from "@liaiso/oxlint-config/react";
import { chatApp } from "@liaiso/oxlint-config/chat";

export default defineConfig({
  extends: [config],
  ignorePatterns: [".tanstack/**", "dist/**", "src/routeTree.gen.ts"],
  overrides: [...chatApp],
});
