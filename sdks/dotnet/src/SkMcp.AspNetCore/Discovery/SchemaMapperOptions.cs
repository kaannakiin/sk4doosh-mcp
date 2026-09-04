using System.Reflection;
using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Discovery;

internal sealed record SchemaMapperOptions
{
    public required Func<PropertyInfo, string> PropertyName { get; init; }

    public Func<Type, JsonObject>? EnumSchema { get; init; }

    public Func<PropertyInfo, JsonObject?>? PropertyEnumOverride { get; init; }

    public bool DropReadOnlyProperties { get; init; } = true;

    public Action<CatalogDiagnostic>? Report { get; init; }

    public int MaxDepth { get; init; } = JsonSchemaMapper.MaxDepth;
}
