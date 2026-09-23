using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Discovery;

internal static class JsonPatchSchema
{
    private static readonly HashSet<string> Namespaces = new(StringComparer.Ordinal)
    {
        "Microsoft.AspNetCore.JsonPatch",
        "Microsoft.AspNetCore.JsonPatch.SystemTextJson",
    };

    /// <remarks>
    /// Matched by name because the SDK references neither JsonPatch package. Reflecting the class
    /// instead describes its <c>Operations</c> list and serializer settings as an object, which no
    /// backend accepts: the wire form is the RFC 6902 array. Microsoft.AspNetCore.OpenApi matches
    /// the same way for the same reason.
    /// </remarks>
    public static bool IsDocument(Type type)
    {
        for (Type? current = type; current is not null && current != typeof(object); current = current.BaseType)
        {
            if (current.Namespace is { } ns
                && Namespaces.Contains(ns)
                && (current.Name == "JsonPatchDocument"
                    || (current.IsGenericType && current.Name == "JsonPatchDocument`1")))
            {
                return true;
            }
        }
        return false;
    }

    public static JsonObject Operations() => new()
    {
        ["type"] = "array",
        ["items"] = new JsonObject
        {
            ["oneOf"] = new JsonArray(
                Operation(["add", "replace", "test"], "value", new JsonObject()),
                Operation(["move", "copy"], "from", new JsonObject { ["type"] = "string" }),
                Operation(["remove"], null, null)),
        },
    };

    private static JsonObject Operation(string[] ops, string? operand, JsonObject? operandSchema)
    {
        JsonObject properties = new()
        {
            ["op"] = new JsonObject
            {
                ["type"] = "string",
                ["enum"] = new JsonArray([.. ops.Select(op => JsonValue.Create(op))]),
            },
            ["path"] = new JsonObject { ["type"] = "string" },
        };
        JsonArray required = ["op", "path"];
        if (operand is not null)
        {
            properties[operand] = operandSchema;
            required.Add(operand);
        }
        return new JsonObject
        {
            ["type"] = "object",
            ["additionalProperties"] = false,
            ["required"] = required,
            ["properties"] = properties,
        };
    }
}
