import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import ExcelJS from "exceljs";
import { createWorkbookRoot } from "../../dist/paths.js";
import { createHandlers } from "../../dist/tools.js";
import { closeRegexWorkers, withRegex } from "../../dist/regex.js";

const dir = await mkdtemp(join(tmpdir(), "regex-watchdog-"));
const payload = (result) => JSON.parse(result.content[0].text);
try {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Regex");
  sheet.addRow(["text"]);
  sheet.addRow(["a".repeat(200) + "!"]);
  await book.xlsx.writeFile(join(dir, "regex.xlsx"));
  const handlers = createHandlers(await createWorkbookRoot(dir));
  const options = {
    filePath: "regex.xlsx",
    query: "(a+)+$",
    matchMode: "regex",
  };
  const start = performance.now();
  const pathological = handlers.find_in_sheet(options);
  await delay(100);
  const beforeNormal = performance.now();
  const normal = await handlers.describe_workbook({ filePath: "regex.xlsx" });
  assert.notEqual(normal.isError, true);
  const normalMs = performance.now() - beforeNormal;
  assert.ok(normalMs < 1000, `normal MCP response blocked for ${normalMs} ms`);
  assert.equal(payload(await pathological).error, "resource_limit");
  assert.ok(performance.now() - start < 5000);
  assert.equal(
    payload(await handlers.find_in_sheet({ ...options, query: "[" })).error,
    "invalid_pattern",
  );
  assert.equal(
    payload(await handlers.find_in_sheet({ ...options, query: "^(a)\\1(?=a)" }))
      .total,
    1,
  );
  const abort = new AbortController();
  const cancelled = handlers.find_in_sheet(options, { signal: abort.signal });
  await delay(100);
  abort.abort();
  assert.equal(payload(await cancelled).error, "resource_limit");
  assert.equal(
    payload(await handlers.find_in_sheet({ ...options, query: "^a+" })).total,
    1,
  );
  const requests = Array.from({ length: 11 }, () =>
    withRegex("(a+)+$", false, (test) => test(["a".repeat(200) + "!"])).then(
      () => "ok",
      (error) => error.code,
    ),
  );
  await delay(100);
  await closeRegexWorkers();
  assert.ok(
    (await Promise.all(requests)).every((code) => code === "resource_limit"),
  );
  assert.equal(
    (await withRegex("^safe$", false, (test) => test(["safe"])))[0],
    true,
  );
  await assert.rejects(
    withRegex(".", false, (test) => test(["a".repeat(65536)])),
    { code: "resource_limit" },
  );
  console.log(
    JSON.stringify({
      normalMs,
      elapsedMs: performance.now() - start,
      peakRssKiB: process.resourceUsage().maxRSS,
    }),
  );
} finally {
  await closeRegexWorkers();
  await rm(dir, { recursive: true, force: true });
}
