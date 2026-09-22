import { expect, it } from "vitest";
import { parseProbeRecord, runProbe } from "../src/record.js";
import type { GenericEnvelope } from "../src/record.js";

it("F0-05", () => {
  const outcome = runProbe("security", {
    execArgv: ["--max-old-space-size=768"],
    timeoutMs: 240_000,
  });
  expect(outcome.signal, outcome.stderr).toBeNull();
  expect(outcome.status, outcome.stderr).toBe(0);

  const record = parseProbeRecord<GenericEnvelope>(outcome);
  expect(record.task).toBe("F0-05");
  expect(record.blockingRows, JSON.stringify(record.blockingRows)).toEqual([]);
  expect(record.summary.requiresDecision).toBe(0);
  expect(record.verdict).toBe("pass");
}, 260_000);
