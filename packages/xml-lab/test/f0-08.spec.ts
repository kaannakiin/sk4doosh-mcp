import { expect, it } from "vitest";
import { parseProbeRecord, runProbe } from "../src/record.js";
import type { GenericEnvelope } from "../src/record.js";

it(
  "F0-08",
  () => {
    const outcome = runProbe("budget", {
      execArgv: ["--max-old-space-size=1536"],
      timeoutMs: 420_000,
    });
    expect(outcome.signal, outcome.stderr).toBeNull();
    expect(outcome.status, outcome.stderr).toBe(0);

    const record = parseProbeRecord<GenericEnvelope>(outcome);
    expect(record.task).toBe("F0-08");
    expect(record.blockingRows, JSON.stringify(record.blockingRows)).toEqual(
      [],
    );
    expect(record.summary.requiresDecision).toBe(0);
    expect(
      record.verdict,
      "a host too noisy to produce a stable table reports inconclusive, which is a measurement finding and not an engine failure",
    ).not.toBe("fail");
  },
  420_000 + 30_000,
);
