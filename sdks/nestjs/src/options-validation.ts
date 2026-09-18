import type { SkMcpOptions } from "./options.js";

export class SkMcpConfigurationError extends Error {
  constructor(readonly failures: readonly string[]) {
    super(`sk-mcp: invalid configuration.\n  ${failures.join("\n  ")}`);
    this.name = "SkMcpConfigurationError";
  }
}

/**
 * Mirrors the ASP.NET `SkMcpOptionsValidator` so the two surfaces can be audited side by side.
 *
 * @param options the configured options
 * @returns one message per invalid setting, empty when the configuration is usable
 */
export function collectConfigurationFailures(
  options: SkMcpOptions,
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
  return failures;
}

/**
 * @param options the configured options
 * @throws SkMcpConfigurationError when any setting is unusable
 */
export function validateSkMcpOptions(options: SkMcpOptions): void {
  const failures = collectConfigurationFailures(options);
  if (failures.length > 0) {
    throw new SkMcpConfigurationError(failures);
  }
}
