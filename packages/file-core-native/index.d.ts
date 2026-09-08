export interface NativeSnapshot {
  readonly bytes: Buffer;
  readonly size: number;
  readonly modifiedMs: number;
}
export interface NativeEntry {
  readonly path: string;
  readonly size: number;
  readonly modifiedMs: number;
  readonly directory: boolean;
}
export interface NativeScan {
  readonly entries: readonly NativeEntry[];
  readonly visited: number;
  readonly unreadable: number;
  readonly reason: "entries" | "depth" | "time" | null;
}
export interface NativeRoot {
  resolve(path: string): Promise<string>;
  read(path: string, maxBytes: number): Promise<NativeSnapshot>;
  scan(
    path: string,
    maxEntries: number,
    maxDepth: number,
    maxMs: number,
  ): Promise<NativeScan>;
}
export function openRoot(path: string): NativeRoot;
