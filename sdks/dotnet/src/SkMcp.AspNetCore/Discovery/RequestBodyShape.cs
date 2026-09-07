using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Discovery;

internal static class RequestBodyShape
{
    public static string? TypeOf(JsonNode? node) => node switch
    {
        JsonValue value when value.TryGetValue(out string? text) => text,
        JsonArray union => union
            .Select(TypeOf)
            .FirstOrDefault(candidate => candidate is not null and not "null"),
        _ => null,
    };

    public const string BodyRootArgument = "body";

    public static bool IsObject(JsonObject schema) => TypeOf(schema["type"]) == "object";

    public static string? BodyRootOf(JsonObject schema) =>
        TypeOf(schema["type"]) switch
        {
            null => null,
            "object" => null,
            _ => BodyRootArgument,
        };

    public static bool AllowsAdditional(JsonObject schema) => schema["additionalProperties"] switch
    {
        null => false,
        JsonValue value when value.TryGetValue(out bool flag) => flag,
        _ => true,
    };
}
