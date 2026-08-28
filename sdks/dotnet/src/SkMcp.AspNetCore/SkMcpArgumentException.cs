namespace SkMcp.AspNetCore;

public sealed class SkMcpTemplateException(string message) : Exception(message);

public sealed class SkMcpArgumentException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;

    public const string UnknownArgument = "unknown_argument";
    public const string InvalidPathType = "invalid_path_type";
    public const string MissingPathParameter = "missing_path_parameter";
    public const string HeaderInjection = "header_injection";
    public const string NullNotAllowed = "null_not_allowed";
    public const string InvalidType = "invalid_type";
}
