import type { LiaisoOptions } from "./options.js";

export class LiaisoConfigurationError extends Error {
  constructor(readonly failures: readonly string[]) {
    super(`liaiso: invalid configuration.\n  ${failures.join("\n  ")}`);
    this.name = "LiaisoConfigurationError";
  }
}

/**
 * Mirrors the ASP.NET `LiaisoOptionsValidator` so the two surfaces can be audited side by side.
 *
 * @param options the configured options
 * @returns one message per invalid setting, empty when the configuration is usable
 */
export function collectConfigurationFailures(
  options: LiaisoOptions,
): readonly string[] {
  const failures: string[] = [];
  if (options.cache.lifetimeMs < 0) {
    failures.push("cache.lifetimeMs must be zero or positive.");
  }
  if (options.cache.maxCallers < 1) {
    failures.push("cache.maxCallers must be at least 1.");
  }
  if (options.visibility.probeTopK < 0) {
    failures.push("visibility.probeTopK must be zero or positive.");
  }
  if (options.visibility.probeConcurrency < 1) {
    failures.push("visibility.probeConcurrency must be at least 1.");
  }
  if (options.invoke.maxResponseBytes < 1) {
    failures.push("invoke.maxResponseBytes must be at least 1.");
  }
  if (options.invoke.timeoutMs < 0) {
    failures.push("invoke.timeoutMs must be zero or positive.");
  }
  if (options.invoke.maxInlineFileBytes < 0) {
    failures.push("invoke.maxInlineFileBytes must be zero or positive.");
  }
  if (options.invoke.maxFileBytes < 1) {
    failures.push("invoke.maxFileBytes must be at least 1.");
  }
  const refDescription = options.files.resolver?.refDescription;
  if (refDescription !== undefined && refDescription.trim() === "") {
    failures.push(
      "files.resolver.refDescription must say what a ref is; an agent reads it to find one.",
    );
  }
  /**
   * A blank field is not the catch-all: the catch-all omits the field, while `route: ""` matches
   * only the empty string and no composed route is empty, so the rule would decide nothing.
   */
  (options.selection.rules ?? []).forEach((rule, position) => {
    for (const field of ["route", "method"] as const) {
      const value = rule[field];
      if (value !== undefined && value.trim() === "") {
        failures.push(
          `selection.rules[${position}].${field} must not be blank; omit it to match every ${field}.`,
        );
      }
    }
  });
  return failures;
}

/**
 * @param options the configured options
 * @throws LiaisoConfigurationError when any setting is unusable
 */
export function validateLiaisoOptions(options: LiaisoOptions): void {
  const failures = collectConfigurationFailures(options);
  if (failures.length > 0) {
    throw new LiaisoConfigurationError(failures);
  }
}
