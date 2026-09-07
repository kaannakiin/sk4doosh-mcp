using System.Reflection;
using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Discovery;

internal sealed record SchemaMapperOptions
{
    public required Func<PropertyInfo, string> PropertyName { get; init; }

    public Func<Type, string>? TypeName { get; init; }

    public Func<Type, JsonObject?>? TypeSchema { get; init; }

    public Func<PropertyInfo, JsonObject?>? PropertySchema { get; init; }

    public Func<Type, EnumFacts>? EnumShape { get; init; }

    public bool DropReadOnlyProperties { get; init; } = true;

    public int? MaxDepth { get; init; }

    public Action<CatalogDiagnostic>? Report { get; init; }

    public TypeShapeBinderOptions Binder() => new()
    {
        PropertyName = PropertyName,
        TypeName = TypeName,
        TypeSchema = TypeSchema,
        PropertySchema = PropertySchema,
        EnumShape = EnumShape,
        Report = Report,
    };

    public SchemaWriterOptions Writer() => new()
    {
        DropReadOnlyProperties = DropReadOnlyProperties,
        MaxDepth = MaxDepth,
        Report = Report,
    };
}
