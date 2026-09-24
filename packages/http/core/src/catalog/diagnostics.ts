export type CatalogSeverity = "warning" | "endpointDropped" | "fatal";

export interface CatalogDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type SeverityTable = Readonly<Record<string, CatalogSeverity>>;

export interface DiagnosticsOptions {
  failOn?: CatalogSeverity;
  readonly escalate?: ReadonlySet<string>;
  readonly downgrade?: ReadonlySet<string>;
}

const rank: Readonly<Record<CatalogSeverity, number>> = {
  warning: 0,
  endpointDropped: 1,
  fatal: 2,
};

export function severityIn(
  table: SeverityTable,
  code: string,
  options: DiagnosticsOptions = {},
): CatalogSeverity {
  if (options.escalate?.has(code) === true) {
    return "fatal";
  }
  if (options.downgrade?.has(code) === true) {
    return "warning";
  }
  return table[code] ?? "warning";
}

export function atLeast(
  severity: CatalogSeverity,
  floor: CatalogSeverity,
): boolean {
  return rank[severity] >= rank[floor];
}
