export type SourceMode = "resident" | "chunked";

export interface ModePolicy {
  readonly residentMaxBytes: number;
}

export function modeFor(sizeBytes: number, policy: ModePolicy): SourceMode {
  return sizeBytes > policy.residentMaxBytes ? "chunked" : "resident";
}
