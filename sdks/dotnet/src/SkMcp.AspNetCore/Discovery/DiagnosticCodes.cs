namespace SkMcp.AspNetCore.Discovery;

public enum CatalogSeverity { Warning, EndpointDropped, Fatal }

public static class DiagnosticCodes
{
    public const string AmbiguousSelection = "ambiguous_selection";
    public const string ArgumentCollision = "argument_collision";
    public const string EnumFormatUnresolved = "enum_format_unresolved";
    public const string InvalidName = "invalid_name";
    public const string LongToolName = "long_tool_name";
    public const string MissingHttpMethod = "missing_http_method";
    public const string MultipleBodyBindings = "multiple_body_bindings";
    public const string NameCollision = "name_collision";
    public const string NameDisambiguated = "name_disambiguated";
    public const string NamingPolicyUnresolved = "naming_policy_unresolved";
    public const string NonObjectBody = "non_object_body";
    public const string TemplateRejected = "template_rejected";
    public const string UnsupportedBinding = "unsupported_binding";
    public const string UnsupportedDictionaryKey = "unsupported_dictionary_key";

    private static readonly Dictionary<string, CatalogSeverity> Defaults =
        new(StringComparer.Ordinal)
        {
            [NameCollision] = CatalogSeverity.Fatal,
            [AmbiguousSelection] = CatalogSeverity.Fatal,
            [InvalidName] = CatalogSeverity.Fatal,
            [ArgumentCollision] = CatalogSeverity.EndpointDropped,
            [NonObjectBody] = CatalogSeverity.EndpointDropped,
            [MultipleBodyBindings] = CatalogSeverity.EndpointDropped,
            [UnsupportedBinding] = CatalogSeverity.EndpointDropped,
            [MissingHttpMethod] = CatalogSeverity.EndpointDropped,
            [TemplateRejected] = CatalogSeverity.EndpointDropped,
        };

    public static CatalogSeverity SeverityOf(string code) =>
        Defaults.TryGetValue(code, out CatalogSeverity severity)
            ? severity
            : CatalogSeverity.Warning;
}
