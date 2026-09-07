using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Discovery;

internal static class EnumWireFormat
{
    public static EnumFacts Describe(Type enumType, JsonSerializerOptions serializer)
    {
        List<string> names = [];
        List<int> numbers = [];
        bool strings = true;

        foreach (object value in Enum.GetValues(enumType))
        {
            JsonNodeToken token = Serialize(value, enumType, serializer);
            if (token.Text is null)
            {
                strings = false;
            }
            names.Add(token.Text ?? value.ToString() ?? string.Empty);
            numbers.Add(token.Number ?? Numeric(value));
        }

        return new EnumFacts
        {
            WireForm = strings ? EnumWireForm.String : EnumWireForm.Integer,
            Combinable = enumType.GetCustomAttribute<FlagsAttribute>() is not null,
            Names = names,
            Numbers = numbers,
        };
    }

    public static EnumFacts Unresolved(Type enumType)
    {
        List<string> names = [];
        List<int> numbers = [];
        foreach (object value in Enum.GetValues(enumType))
        {
            names.Add(value.ToString() ?? string.Empty);
            numbers.Add(Numeric(value));
        }
        return new EnumFacts
        {
            WireForm = EnumWireForm.Unresolved,
            Combinable = enumType.GetCustomAttribute<FlagsAttribute>() is not null,
            Names = names,
            Numbers = numbers,
        };
    }

    public static Func<Type, EnumFacts> Cached(Func<Type, EnumFacts> resolve)
    {
        ConcurrentDictionary<Type, EnumFacts> cache = new();
        return enumType => cache.GetOrAdd(enumType, resolve);
    }

    private readonly record struct JsonNodeToken(string? Text, int? Number);

    private static JsonNodeToken Serialize(
        object value, Type enumType, JsonSerializerOptions serializer)
    {
        using JsonDocument document = JsonSerializer.SerializeToDocument(value, enumType, serializer);
        JsonElement element = document.RootElement;
        return element.ValueKind switch
        {
            JsonValueKind.String => new JsonNodeToken(element.GetString(), null),
            JsonValueKind.Number when element.TryGetInt32(out int number) =>
                new JsonNodeToken(null, number),
            _ => new JsonNodeToken(null, null),
        };
    }

    private static int Numeric(object value) =>
        Convert.ToInt32(value, CultureInfo.InvariantCulture);
}
