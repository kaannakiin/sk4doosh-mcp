import type { DescribeFacts, RootFacts } from "./describe.js";
import type { FindPage, FindProbe } from "./find-model.js";
import type {
  ContextRecord,
  NodeAddress,
  NodePath,
  NodeRecord,
} from "./node-model.js";

export type { RootFacts };

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

export interface ReadView {
  readonly address?: NodeAddress;
  readonly scopePath?: NodePath;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxChars: number;
  readonly resume?: NodePath;
}

export interface ReadPage {
  readonly records: readonly NodeRecord[];
  readonly context?: readonly ContextRecord[];
  readonly scopeAddress: NodeAddress;
  readonly scopePath: NodePath;
  readonly next?: NodePath;
}

interface Resident {
  readonly stamp: string;
}

interface WorkerOps {
  parse: {
    req: Resident & { readonly logical: string; readonly bytes: Uint8Array };
    res: ParsedFacts;
  };
  describe: {
    req: Resident & {
      readonly maxVisits: number;
      readonly maxCandidates: number;
    };
    res: DescribeFacts;
  };
  read: { req: Resident & { readonly view: ReadView }; res: ReadPage };
  find: { req: Resident & { readonly probe: FindProbe }; res: FindPage };
  diag: { req: Record<never, never>; res: DiagProjection };
  release: { req: Record<never, never>; res: null };
}

export type WorkerKind = keyof WorkerOps;

export type WorkerResultOf<K extends WorkerKind> = WorkerOps[K]["res"];

export type WorkerRequestBody = {
  [P in WorkerKind]: { readonly kind: P } & WorkerOps[P]["req"];
}[WorkerKind];

export type WorkerBodyOf<K extends WorkerKind> = Extract<
  WorkerRequestBody,
  { readonly kind: K }
>;

export type WorkerRequest = {
  [P in WorkerKind]: {
    readonly kind: P;
    readonly id: number;
  } & WorkerOps[P]["req"];
}[WorkerKind];

export type WorkerFailure =
  | "malformed_xml"
  | "doctype_not_allowed"
  | "unknown_residency"
  | "address_not_found"
  | "internal_error";

export type WorkerSuccess = {
  [P in WorkerKind]: {
    readonly kind: P;
    readonly id: number;
    readonly ok: true;
    readonly value: WorkerOps[P]["res"];
  };
}[WorkerKind];

export interface WorkerRejection {
  readonly kind: WorkerKind | "boot";
  readonly id: number;
  readonly ok: false;
  readonly failure: WorkerFailure;
  readonly detail?: string;
}

export type WorkerReply = WorkerSuccess | WorkerRejection;

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
