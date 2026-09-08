import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("bounds pathological regex outside the test process, keeps MCP live and cleans up cancellation/queue/worker failures (#2)", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./fixtures/regex-watchdog.mjs", import.meta.url))],
    { encoding: "utf8", timeout: 15000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout.trim()) as {
    normalMs: number;
    peakRssKiB: number;
  };
  expect(report.normalMs).toBeLessThan(1000);
  expect(report.peakRssKiB).toBeGreaterThan(0);
}, 20000);
