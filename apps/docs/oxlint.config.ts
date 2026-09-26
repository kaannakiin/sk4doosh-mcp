import { defineConfig } from "oxlint";
import { config } from "@liaiso/oxlint-config/react";

export default defineConfig({
  extends: [config],
  ignorePatterns: [
    "dist/**",
    ".tanstack/**",
    "src/routeTree.gen.ts",
    "scripts/**",
  ],
});
