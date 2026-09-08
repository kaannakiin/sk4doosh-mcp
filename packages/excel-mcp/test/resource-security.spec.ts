import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("measures real CSV byte and wide-record costs separately from sqref parse/describe (#15 #24)", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=512",
      fileURLToPath(
        new URL("./fixtures/measure-hardening.mjs", import.meta.url),
      ),
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  const report = JSON.parse(child.stdout.trim()) as {
    csvBytes: number;
    peakRssKiB: number;
    validationCachedDescribeMs: number;
  };
  expect(report.csvBytes).toBe(16 * 1024 * 1024);
  expect(report.peakRssKiB).toBeLessThan(1024 * 1024);
}, 35000);
