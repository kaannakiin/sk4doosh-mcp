export interface OoxmlLimits {
  readonly maxPartBytes: number;
  readonly maxDecodedPackageBytes: number;
  readonly maxExpansionRatio: number;
  readonly ratioFloorBytes: number;
  readonly maxPartCount: number;
}

/**
 * Guard: maxPartBytes stays below Node's MAX_STRING_LENGTH (536870888 UTF-16
 * characters). `part()` returns a decoded string, so a ceiling at or above that
 * turns an oversized part into V8's "Cannot create a string longer than" throw
 * instead of a `part_too_large` the caller can act on.
 *
 * Guard: the ratio gate applies only above ratioFloorBytes, and at a ratio far
 * above what real packages reach. Measured: 40:1 was the highest across the
 * Office files in this repository, and a full-height spreadsheet sheet reaches
 * 7.6:1 at 214 MiB expanded. A single deflate stream cannot exceed roughly
 * 1032:1, so 200 refuses bombs while leaving legitimate documents untouched. A
 * single absolute ceiling cannot do both.
 */
export const ooxmlLimits = {
  maxPartBytes: 384 * 1024 * 1024, // 384 MiB, below Node's MAX_STRING_LENGTH
  maxDecodedPackageBytes: 512 * 1024 * 1024, // 512 MiB, below Node's MAX_STRING_LENGTH
  maxExpansionRatio: 200,
  ratioFloorBytes: 16 * 1024 * 1024, // 16 MiB, above the largest measured expansion ratio
  maxPartCount: 4096,
} as const satisfies OoxmlLimits;
