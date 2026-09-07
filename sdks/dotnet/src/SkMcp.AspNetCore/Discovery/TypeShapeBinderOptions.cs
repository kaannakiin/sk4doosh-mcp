using System.Reflection;
using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Discovery;

internal sealed record TypeShapeBinderOptions
{
    public required Func<PropertyInfo, string> PropertyName { get; init; }

    public Func<Type, string>? TypeName { get; init; }

    public Func<Type, JsonObject?>? TypeSchema { get; init; }

    public Func<PropertyInfo, JsonObject?>? PropertySchema { get; init; }

    public Func<Type, EnumFacts>? EnumShape { get; init; }

    public Action<CatalogDiagnostic>? Report { get; init; }
}
