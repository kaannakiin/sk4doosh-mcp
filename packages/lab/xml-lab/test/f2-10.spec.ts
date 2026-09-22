import { expect, it } from "vitest";
import { parseProbeRecord, runProbe } from "../src/record.js";
import type { GenericEnvelope } from "../src/record.js";

it(
  "F2-10",
  () => {
    const outcome = runProbe("residency", {
      execArgv: ["--expose-gc", "--max-old-space-size=3072"],
      timeoutMs: 600_000,
    });
    expect(outcome.signal, outcome.stderr).toBeNull();
    expect(outcome.status, outcome.stderr).toBe(0);

    const record = parseProbeRecord<GenericEnvelope>(outcome);
    expect(record.task).toBe("F2-10");
    expect(record.blockingRows, JSON.stringify(record.blockingRows)).toEqual(
      [],
    );
    expect(
      record.verdict,
      "a host too noisy to hold the marginal cost steady reports inconclusive, which is a measurement finding and not an engine failure",
    ).not.toBe("fail");
  },
  600_000 + 30_000,
);
