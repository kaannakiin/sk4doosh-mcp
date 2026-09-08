import { expect, it } from "vitest";
import { parseProbeRecord, runProbe } from "../src/record.js";
import type { GenericEnvelope } from "../src/record.js";

it(
  "F0-06",
  () => {
    const outcome = runProbe("worker-lifecycle", {
      execArgv: ["--max-old-space-size=1536"],
      timeoutMs: 900_000,
    });
    expect(outcome.signal, outcome.stderr).toBeNull();
    expect(outcome.status, outcome.stderr).toBe(0);

    const record = parseProbeRecord<GenericEnvelope>(outcome);
    expect(record.task).toBe("F0-06");
    expect(record.blockingRows, JSON.stringify(record.blockingRows)).toEqual(
      [],
    );
    expect(record.summary.requiresDecision).toBe(0);
    expect(record.verdict).toBe("pass");
  },
  240_000 + 30_000,
);
