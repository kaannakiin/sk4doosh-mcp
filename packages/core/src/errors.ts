export type SkMcpTemplateErrorCode =
  | "empty_route"
  | "body_not_allowed"
  | "duplicate_argument"
  | "identity_carrier_argument"
  | "path_parameter_array"
  | "argument_collision"
  | "route_placeholder_mismatch";

export class SkMcpTemplateError extends Error {
  constructor(
    readonly code: SkMcpTemplateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SkMcpTemplateError";
  }
}

export type SkMcpArgumentErrorCode =
  | "unknown_argument"
  | "invalid_path_type"
  | "missing_path_parameter"
  | "header_injection"
  | "null_not_allowed"
  | "invalid_type";

export class SkMcpArgumentError extends Error {
  constructor(
    readonly code: SkMcpArgumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SkMcpArgumentError";
  }
}

export type SkMcpCatalogErrorCode =
  "name_collision" | "invalid_name" | "ambiguous_selection";

export class SkMcpCatalogError extends Error {
  constructor(
    readonly code: SkMcpCatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SkMcpCatalogError";
  }
}
