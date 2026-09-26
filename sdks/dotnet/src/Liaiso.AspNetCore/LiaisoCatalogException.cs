namespace Liaiso.AspNetCore;

public sealed class LiaisoCatalogException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;

    public const string NameCollision = "name_collision";
    public const string InvalidName = "invalid_name";
    public const string AmbiguousSelection = "ambiguous_selection";
}
