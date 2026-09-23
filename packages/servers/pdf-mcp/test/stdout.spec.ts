import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, inject, it } from "vitest";

/**
 * Guard: stdout is the protocol channel. A native engine that writes a warning
 * there corrupts the JSON-RPC stream and the client loses the session with no
 * error to show, so this drives the built CLI through a real extraction and
 * asserts fd 1 carried nothing but frames.
 */
it("keeps fd 1 free of anything but JSON-RPC frames", () => {
  const fixtures = inject("fixtures");
  const probe = fileURLToPath(
    new URL("./fixtures/measure-stdout.mjs", import.meta.url),
  );
  const child = spawnSync(process.execPath, [probe, fixtures.root], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  const report = JSON.parse(child.stdout.trim()) as {
    lines: number;
    allFramed: boolean;
    responded: boolean;
  };
  expect(report.allFramed).toBe(true);
  expect(report.responded).toBe(true);
}, 40_000);
