using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Spec;

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

    /// <summary>
    /// Decides whether the body travels as one synthetic argument instead of flattening.
    /// A body declared <c>required: false</c> always does, because a flattened body has no
    /// wrapper left to omit and would always send <c>{}</c>.
    /// </summary>
    /// <returns>The synthetic argument name, or <c>null</c> to flatten the body's fields.</returns>
    public static string? BodyRootOf(RequestBody body) =>
        body.Required == false
            ? BodyRootArgument
            : TypeOf(body.Schema["type"]) switch
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
