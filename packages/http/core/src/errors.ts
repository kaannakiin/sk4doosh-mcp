export type SkMcpTemplateErrorCode =
  | "empty_route"
  | "body_not_allowed"
  | "conflicting_body_modes"
  | "duplicate_argument"
  | "identity_carrier_argument"
  | "path_parameter_array"
  | "header_parameter_array"
  | "unsupported_array_style"
  | "unsupported_object_style"
  | "unsupported_object_nesting"
  | "argument_collision"
  | "route_placeholder_mismatch"
  | "schema_def_conflict"
  | "curation_unresolved"
  | "invalid_fill_constant"
  | "hidden_required_omitted"
  | "variant_declaration_conflict"
  | "sealed_curation_overridden"
  | "ambiguous_curation"
  | "unsupported_body_shape";

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
  | "invalid_type"
  | "deferred_value_missing"
  | "deferred_value_invalid"
  | "invalid_file_argument"
  | "file_too_large";

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
