using System.Reflection;
using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Discovery;

internal static class JsonSchemaMapper
{
    public static JsonObject Map(Type type, Func<PropertyInfo, string>? propertyName = null) =>
        Map(type, new SchemaMapperOptions
        {
            PropertyName = propertyName ?? (property => property.Name),
        });

    public static JsonObject Map(Type type, SchemaMapperOptions options) =>
        new SchemaWriter(options.Writer()).Write(TypeShapeBinder.Bind(type, options.Binder()));
}
