using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Discovery;

internal static class EnumWireFormat
{
    public static JsonObject Describe(Type enumType, JsonSerializerOptions serializer)
    {
        List<JsonNode?> tokens = [];
        bool strings = true;
        foreach (object value in Enum.GetValues(enumType))
        {
            JsonNode? token = JsonSerializer.SerializeToNode(value, enumType, serializer);
            if (token is not JsonValue candidate || !candidate.TryGetValue(out string? _))
            {
                strings = false;
            }
            tokens.Add(token);
        }

        JsonObject schema = new() { ["type"] = strings ? "string" : "integer" };
        if (enumType.GetCustomAttribute<FlagsAttribute>() is not null)
        {
            return schema;
        }

        JsonArray values = [];
        foreach (JsonNode? token in tokens)
        {
            values.Add(token);
        }
        schema["enum"] = values;
        return schema;
    }

    public static JsonObject Unresolved(Type enumType)
    {
        JsonArray names = [];
        JsonArray numbers = [];
        foreach (object value in Enum.GetValues(enumType))
        {
            names.Add(value.ToString());
            numbers.Add(Convert.ToInt64(value, System.Globalization.CultureInfo.InvariantCulture));
        }
        if (enumType.GetCustomAttribute<FlagsAttribute>() is not null)
        {
            return new JsonObject
            {
                ["anyOf"] = new JsonArray(
                    new JsonObject { ["type"] = "string" },
                    new JsonObject { ["type"] = "integer" }),
            };
        }
        return new JsonObject
        {
            ["anyOf"] = new JsonArray(
                new JsonObject { ["type"] = "string", ["enum"] = names },
                new JsonObject { ["type"] = "integer", ["enum"] = numbers }),
        };
    }

    public static Func<Type, JsonObject> Cached(Func<Type, JsonObject> resolve)
    {
        ConcurrentDictionary<Type, JsonObject> cache = new();
        return enumType => (JsonObject)cache.GetOrAdd(enumType, resolve).DeepClone();
    }
}
