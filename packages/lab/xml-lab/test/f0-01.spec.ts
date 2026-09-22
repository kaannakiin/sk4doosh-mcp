import { expect, it } from "vitest";
import {
  parseProbeRecord,
  runProbe,
  type SurfaceEnvelope,
} from "../src/record.js";

it("records the installed libxml2-wasm surface and pins every downstream assumption (F0-01)", () => {
  const outcome = runProbe("surface", { timeoutMs: 60_000 });
  expect(outcome.signal, outcome.stderr).toBeNull();
  expect(outcome.status, outcome.stderr).toBe(0);

  const record = parseProbeRecord<SurfaceEnvelope>(outcome);

  expect(record.schemaVersion).toBe(1);
  expect(record.task).toBe("F0-01");
  expect(record.engine.version).toBe("0.7.2");
  expect(record.engine.lockfileIntegrity).toMatch(/^sha512-/);
  expect(record.engine.artifactMatchesReviewedRevision).toBe(false);
  expect(record.engine.embeddedLibxml2Version).not.toBeNull();
  expect(record.runtime.maxRssUnit).not.toBe("unknown");
  expect(record.blockingRows, JSON.stringify(record.blockingRows)).toEqual([]);
  expect(record.verdict).toBe("pass");
  expect(record.limits.length).toBeGreaterThan(0);
}, 70_000);
