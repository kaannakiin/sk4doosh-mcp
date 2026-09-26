export type LiaisoTemplateErrorCode =
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
  | "unsupported_body_shape"
  | "unsupported_parameter_style"
  | "invalid_cookie_name"
  | "identity_carrier_parameter"
  | "unsupported_parameter_content"
  | "multiple_querystring"
  | "querystring_with_query";

export class LiaisoTemplateError extends Error {
  constructor(
    readonly code: LiaisoTemplateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LiaisoTemplateError";
  }
}

export type LiaisoArgumentErrorCode =
  | "unknown_argument"
  | "invalid_path_type"
  | "missing_path_parameter"
  | "header_injection"
  | "null_not_allowed"
  | "invalid_type"
  | "deferred_value_missing"
  | "deferred_value_invalid"
  | "invalid_cookie_value"
  | "cookie_carrier_collision"
  | "invalid_file_argument"
  | "file_too_large";

export class LiaisoArgumentError extends Error {
  constructor(
    readonly code: LiaisoArgumentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LiaisoArgumentError";
  }
}

export type LiaisoCatalogErrorCode =
  "name_collision" | "invalid_name" | "ambiguous_selection";

export class LiaisoCatalogError extends Error {
  constructor(
    readonly code: LiaisoCatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LiaisoCatalogError";
  }
}
