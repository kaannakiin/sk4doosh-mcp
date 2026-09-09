export interface RootFacts {
  readonly localName: string;
  readonly namespaceUri: string;
  readonly prefixedName: string;
}

export interface ParsedFacts {
  readonly declaredEncoding: string | null;
  readonly warningCount: number;
  readonly root: RootFacts;
}

export interface DiagProjection {
  readonly live: number;
  readonly collected: number;
  readonly cached: number;
}

export type WorkerRequest =
  | {
      readonly kind: "parse";
      readonly id: number;
      readonly stamp: string;
      readonly logical: string;
      readonly bytes: Uint8Array;
    }
  | { readonly kind: "diag"; readonly id: number }
  | { readonly kind: "release"; readonly id: number };

export type WorkerRequestBody<T = WorkerRequest> = T extends { id: number }
  ? Omit<T, "id">
  : never;

export type WorkerFailure =
  | "malformed_xml"
  | "doctype_not_allowed"
  | "unknown_residency"
  | "internal_error";

export type WorkerReply =
  | { readonly id: number; readonly ok: true; readonly facts: ParsedFacts }
  | { readonly id: number; readonly ok: true; readonly diag: DiagProjection }
  | { readonly id: number; readonly ok: true }
  | {
      readonly id: number;
      readonly ok: false;
      readonly failure: WorkerFailure;
      readonly detail?: string;
    };

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
