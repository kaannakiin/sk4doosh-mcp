export const limits = {
  maxFileBytes: 50 * 1024 * 1024, // 50 MB
  maxCellsHard: 10_000,
  maxCellsDefault: 2_000,
  maxPayloadBytes: 512 * 1024, // 512 KB
  maxStringChars: 512,
  maxListResults: 200,
  defaultListResults: 50,
  maxListScan: 5_000,
  maxFindResults: 200,
  defaultFindResults: 50,
  maxRegexSource: 256,
  maxRangesPerRule: 64,
  documentCacheSize: 4,
  maxCsvBytes: 16 * 1024 * 1024, // 16 MB
  maxCsvCells: 2_000_000,
  csvNulScanBytes: 8 * 1024, // 8 KB
  csvSniffBytes: 64 * 1024, // 64 KB
  csvSniffLines: 20,
  headerScanRows: 20,
  maxGroupsDefault: 50,
  maxGroupsHard: 500,
  maxConditions: 16,
  maxMetrics: 8,
  maxInValues: 64,
  guidanceRowThreshold: 5_000,
} as const;

export type Limits = typeof limits;
