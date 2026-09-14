import type { DiagProjection } from "../model/worker.js";

interface DiagEntry {
  readonly totalInstances: number;
  readonly garbageCollected: number;
}

export function projectDiag(
  report: Readonly<Record<string, DiagEntry>>,
  cached: number,
): DiagProjection {
  let live = 0;
  let collected = 0;
  for (const entry of Object.values(report)) {
    live += entry.totalInstances;
    collected += entry.garbageCollected;
  }
  return { live, collected, cached };
}
