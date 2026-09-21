export const coreLimits = {
  maxFileBytes: 50 * 1024 * 1024,
  maxPayloadBytes: 512 * 1024,
  maxStringChars: 512,
  maxListResults: 200,
  defaultListResults: 50,
  maxListScan: 5_000,
  documentCacheSize: 4,
  catalogTtlMs: 5 * 60 * 1000,
} as const;

export type CoreLimits = typeof coreLimits;
