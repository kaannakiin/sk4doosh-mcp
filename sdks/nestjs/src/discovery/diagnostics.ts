export type CatalogSeverity = "warning" | "endpointDropped" | "fatal";

export interface CatalogDiagnostic {
  readonly code: string;
  readonly message: string;
}

const defaults: Readonly<Record<string, CatalogSeverity>> = {
  name_collision: "fatal",
  ambiguous_selection: "fatal",
  invalid_name: "fatal",
  argument_collision: "endpointDropped",
  multiple_body_bindings: "endpointDropped",
  unsupported_binding: "endpointDropped",
  unsupported_method: "endpointDropped",
  schema_def_conflict: "endpointDropped",
  template_rejected: "endpointDropped",
};

const rank: Readonly<Record<CatalogSeverity, number>> = {
  warning: 0,
  endpointDropped: 1,
  fatal: 2,
};

export interface DiagnosticsOptions {
  failOn?: CatalogSeverity;
  readonly escalate?: Set<string>;
  readonly downgrade?: Set<string>;
}

export function severityOf(
  code: string,
  options: DiagnosticsOptions = {},
): CatalogSeverity {
  if (options.escalate?.has(code) === true) {
    return "fatal";
  }
  if (options.downgrade?.has(code) === true) {
    return "warning";
  }
  return defaults[code] ?? "warning";
}

export function atLeast(
  severity: CatalogSeverity,
  floor: CatalogSeverity,
): boolean {
  return rank[severity] >= rank[floor];
}
