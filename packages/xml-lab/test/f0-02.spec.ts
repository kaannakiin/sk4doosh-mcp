import { expect, it } from "vitest";
import { parseProbeRecord, runProbe } from "../src/record.js";
import type { ConsumerEnvelope } from "../src/record.js";

const offline = process.env.SKMCP_XML_F0_NO_NETWORK === "1";

it.skipIf(offline)(
  "installs the engine as an end user would and keeps stdout protocol-clean (F0-02)",
  () => {
    const outcome = runProbe("isolated-consumer", { timeoutMs: 300_000 });
    expect(outcome.signal, outcome.stderr).toBeNull();
    expect(outcome.status, outcome.stderr).toBe(0);

    const record = parseProbeRecord<ConsumerEnvelope>(outcome);

    expect(record.task).toBe("F0-02");
    expect(record.blockingRows, JSON.stringify(record.blockingRows)).toEqual(
      [],
    );
    expect(record.verdict).toBe("pass");
    expect(record.metrics.coldModuleImportMs.p95).toBeGreaterThan(0);
    expect(record.metrics.warmParseMs.samples).toBeGreaterThan(0);
  },
  330_000,
);
