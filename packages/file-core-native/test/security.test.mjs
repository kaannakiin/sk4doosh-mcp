import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRoot } from "../index.js";

test(
  "special files and filesystem races are bounded by an external watchdog",
  { timeout: 35000 },
  () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./watchdog.mjs", import.meta.url))],
      { encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout.trim());
    assert.equal(report.secretReads, 0);
    console.log(JSON.stringify(report));
  },
);

test("traversal budgets count unsupported entries and bound depth/time", async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "native-scan-")));
  try {
    for (let i = 0; i < 12; i += 1)
      await writeFile(join(path, `${i}.unsupported`), "x");
    const root = openRoot(path);
    const limited = await root.scan("", 10, 64, 1000);
    assert.equal(limited.visited, 10);
    assert.equal(limited.reason, "entries");
    assert.equal((await root.scan("", 20, 64, 1000)).visited, 12);
    assert.equal((await root.scan("", 20, 64, 1000)).reason, null);
    assert.equal((await root.scan("", 20, 64, 0)).reason, "time");
    await mkdir(join(path, "a"));
    await mkdir(join(path, "a", "b"));
    assert.equal((await root.scan("", 20, 0, 1000)).reason, "depth");
    for (let start = 12; start < 5001; start += 128) {
      await Promise.all(
        Array.from({ length: Math.min(128, 5001 - start) }, (_, offset) =>
          writeFile(join(path, `${start + offset}.unsupported`), "x"),
        ),
      );
    }
    const large = await root.scan("", 5000, 64, 1000);
    assert.ok(large.visited <= 5000);
    assert.ok(["entries", "time"].includes(large.reason));
    assert.ok(process.resourceUsage().maxRSS < 256 * 1024);
    console.log(
      JSON.stringify({
        scanVisited: large.visited,
        scanReason: large.reason,
        peakRssKiB: process.resourceUsage().maxRSS,
      }),
    );
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
