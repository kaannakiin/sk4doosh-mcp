namespace SkMcp.AspNetCore;

public sealed class SkMcpTemplateException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;

    public const string ArgumentCollision = "argument_collision";
    public const string DuplicateArgument = "duplicate_argument";
    public const string IdentityCarrierArgument = "identity_carrier_argument";
    public const string BodyNotAllowed = "body_not_allowed";
    public const string ConflictingBodyModes = "conflicting_body_modes";
    public const string PathParameterArray = "path_parameter_array";
    public const string HeaderParameterArray = "header_parameter_array";
    public const string UnsupportedArrayStyle = "unsupported_array_style";
    public const string UnsupportedObjectStyle = "unsupported_object_style";
    public const string UnsupportedObjectNesting = "unsupported_object_nesting";
    public const string RoutePlaceholderMismatch = "route_placeholder_mismatch";
    public const string CurationUnresolved = "curation_unresolved";
    public const string InvalidFillConstant = "invalid_fill_constant";
    public const string HiddenRequiredOmitted = "hidden_required_omitted";
    public const string VariantDeclarationConflict = "variant_declaration_conflict";
    public const string AmbiguousCuration = "ambiguous_curation";
    public const string SealedCurationOverridden = "sealed_curation_overridden";
}

public sealed class SkMcpArgumentException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;

    public const string UnknownArgument = "unknown_argument";
    public const string InvalidPathType = "invalid_path_type";
    public const string MissingPathParameter = "missing_path_parameter";
    public const string HeaderInjection = "header_injection";
    public const string NullNotAllowed = "null_not_allowed";
    public const string InvalidType = "invalid_type";
    public const string DeferredValueMissing = "deferred_value_missing";
    public const string DeferredValueInvalid = "deferred_value_invalid";
}
