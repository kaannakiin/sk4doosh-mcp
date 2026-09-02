using System.Collections;
using System.Reflection;
using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Discovery;

public static class JsonSchemaMapper
{
    public const int MaxDepth = 3;

    public static JsonObject Map(Type type, Func<PropertyInfo, string>? propertyName = null) =>
        Map(type, 0, [], propertyName ?? (property => property.Name));

    private static JsonObject Map(
        Type type, int depth, HashSet<Type> path, Func<PropertyInfo, string> propertyName)
    {
        Type resolved = Nullable.GetUnderlyingType(type) ?? type;

        if (Scalar(resolved) is { } scalar)
        {
            return scalar;
        }
        if (resolved.IsEnum)
        {
            JsonArray values = [];
            foreach (string name in Enum.GetNames(resolved))
            {
                values.Add(name);
            }
            return new JsonObject { ["type"] = "string", ["enum"] = values };
        }
        if (ItemType(resolved) is { } item)
        {
            return new JsonObject
            {
                ["type"] = "array",
                ["items"] = depth >= MaxDepth ? Opaque() : Map(item, depth + 1, path, propertyName),
            };
        }
        if (typeof(IDictionary).IsAssignableFrom(resolved))
        {
            return Opaque();
        }
        if (depth >= MaxDepth || !path.Add(resolved))
        {
            return Opaque();
        }

        JsonObject properties = [];
        foreach (PropertyInfo property in resolved.GetProperties(
            BindingFlags.Public | BindingFlags.Instance))
        {
            if (property.GetIndexParameters().Length > 0 || !property.CanRead)
            {
                continue;
            }
            properties[propertyName(property)] = Map(property.PropertyType, depth + 1, path, propertyName);
        }
        path.Remove(resolved);

        return new JsonObject { ["type"] = "object", ["properties"] = properties };
    }

    private static JsonObject Opaque() => new() { ["type"] = "object" };

    private static JsonObject? Scalar(Type type)
    {
        if (type == typeof(string) || type == typeof(char))
        {
            return new JsonObject { ["type"] = "string" };
        }
        if (type == typeof(bool))
        {
            return new JsonObject { ["type"] = "boolean" };
        }
        if (type == typeof(byte) || type == typeof(sbyte) || type == typeof(short)
            || type == typeof(ushort) || type == typeof(int) || type == typeof(uint)
            || type == typeof(long) || type == typeof(ulong))
        {
            return new JsonObject { ["type"] = "integer" };
        }
        if (type == typeof(float) || type == typeof(double) || type == typeof(decimal))
        {
            return new JsonObject { ["type"] = "number" };
        }
        if (type == typeof(Guid))
        {
            return new JsonObject { ["type"] = "string", ["format"] = "uuid" };
        }
        if (type == typeof(DateTime) || type == typeof(DateTimeOffset))
        {
            return new JsonObject { ["type"] = "string", ["format"] = "date-time" };
        }
        if (type == typeof(DateOnly))
        {
            return new JsonObject { ["type"] = "string", ["format"] = "date" };
        }
        if (type == typeof(TimeOnly) || type == typeof(TimeSpan) || type == typeof(Uri))
        {
            return new JsonObject { ["type"] = "string" };
        }
        return null;
    }

    private static Type? ItemType(Type type)
    {
        if (type == typeof(string) || !typeof(IEnumerable).IsAssignableFrom(type))
        {
            return null;
        }
        if (type.IsArray)
        {
            return type.GetElementType();
        }
        foreach (Type contract in type.GetInterfaces().Append(type))
        {
            if (contract.IsGenericType && contract.GetGenericTypeDefinition() == typeof(IEnumerable<>))
            {
                return contract.GetGenericArguments()[0];
            }
        }
        return typeof(object);
    }
}
