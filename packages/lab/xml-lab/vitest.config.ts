import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    globalSetup: ["test/fixtures/global-setup.ts"],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
