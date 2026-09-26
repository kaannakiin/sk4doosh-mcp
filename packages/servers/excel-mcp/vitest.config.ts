import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    globalSetup: ["test/fixtures/global-setup.ts"],
    maxWorkers: 2,
    /**
     * Guard: the first test in a file that opens the 20k-row large.xlsx pays
     * its cold parse, measured at 5.4–5.7 s on GitHub's linux-x64 and
     * darwin-x64 runners against vitest's 5 s default.
     */
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json", "json-summary"],
      include: ["src/**/*.ts"],
    },
  },
});
