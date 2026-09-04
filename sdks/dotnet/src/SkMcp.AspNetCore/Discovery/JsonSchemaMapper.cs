using System.Collections;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Discovery;

internal static class JsonSchemaMapper
{
    public const int MaxDepth = 3;

    private readonly record struct MapShape(Type Key, Type Value);

    public static JsonObject Map(Type type, Func<PropertyInfo, string>? propertyName = null) =>
        Map(type, new SchemaMapperOptions
        {
            PropertyName = propertyName ?? (property => property.Name),
        });

    public static JsonObject Map(Type type, SchemaMapperOptions options) =>
        Map(type, 0, [], options);

    private static JsonObject Map(Type type, int depth, HashSet<Type> path, SchemaMapperOptions options)
    {
        Type resolved = Nullable.GetUnderlyingType(type) ?? type;

        if (Binary(resolved))
        {
            return new JsonObject { ["type"] = "string", ["contentEncoding"] = "base64" };
        }
        if (Scalar(resolved) is { } scalar)
        {
            return scalar;
        }
        if (resolved.IsEnum)
        {
            return options.EnumSchema is { } describe
                ? describe(resolved)
                : EnumWireFormat.Describe(resolved, JsonSerializerOptions.Default);
        }
        if (MapDescriptor(resolved) is { } shape)
        {
            return MapOf(resolved, shape, depth, path, options);
        }
        if (ItemType(resolved) is { } item)
        {
            return new JsonObject
            {
                ["type"] = "array",
                ["items"] = depth >= options.MaxDepth
                    ? Opaque()
                    : Map(item, depth + 1, path, options),
            };
        }
        if (depth >= options.MaxDepth || !path.Add(resolved))
        {
            return Opaque();
        }

        JsonObject properties = [];
        JsonArray required = [];
        ConstructorInfo? primary = PrimaryConstructor(resolved);
        foreach (PropertyInfo property in Declared(resolved))
        {
            ParameterInfo? parameter = Correlate(primary, property);
            if (options.DropReadOnlyProperties
                && !property.CanWrite
                && parameter is null
                && !IsPopulatable(property.PropertyType))
            {
                continue;
            }

            JsonObject member = options.PropertyEnumOverride?.Invoke(property)
                ?? Map(property.PropertyType, depth + 1, path, options);
            Annotate(member, property, parameter);

            string name = options.PropertyName(property);
            properties[name] = member;
            if (IsRequired(property, parameter))
            {
                required.Add(name);
            }
        }
        path.Remove(resolved);

        JsonObject schema = new() { ["type"] = "object", ["properties"] = properties };
        if (required.Count > 0)
        {
            schema["required"] = required;
        }
        return schema;
    }

    private static JsonObject MapOf(
        Type declaring, MapShape shape, int depth, HashSet<Type> path, SchemaMapperOptions options)
    {
        if (!TryKeySchema(shape.Key, out JsonObject? keySchema))
        {
            options.Report?.Invoke(new CatalogDiagnostic(
                "unsupported_dictionary_key",
                $"'{declaring.Name}' is keyed by '{shape.Key.Name}', which the serializer cannot write as a JSON property name; the value shape was dropped."));
            return Opaque();
        }

        JsonObject map = new()
        {
            ["type"] = "object",
            ["additionalProperties"] = depth >= options.MaxDepth
                ? Opaque()
                : Map(shape.Value, depth + 1, path, options),
        };
        if (keySchema is not null)
        {
            map["propertyNames"] = keySchema;
        }
        return map;
    }

    private static ConstructorInfo? PrimaryConstructor(Type type)
    {
        ConstructorInfo[] constructors = type.GetConstructors(BindingFlags.Public | BindingFlags.Instance);
        if (constructors.Length == 1)
        {
            return constructors[0];
        }

        HashSet<string> names = new(
            type.GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => p.Name),
            StringComparer.OrdinalIgnoreCase);

        ConstructorInfo? best = null;
        int widest = 0;
        bool ambiguous = false;
        foreach (ConstructorInfo candidate in constructors)
        {
            ParameterInfo[] parameters = candidate.GetParameters();
            if (parameters.Length == 0
                || !parameters.All(p => p.Name is not null && names.Contains(p.Name)))
            {
                continue;
            }
            if (parameters.Length > widest)
            {
                best = candidate;
                widest = parameters.Length;
                ambiguous = false;
            }
            else if (parameters.Length == widest)
            {
                ambiguous = true;
            }
        }
        return ambiguous ? null : best;
    }

    private static ParameterInfo? Correlate(ConstructorInfo? primary, PropertyInfo property) =>
        primary?.GetParameters().FirstOrDefault(
            p => string.Equals(p.Name, property.Name, StringComparison.OrdinalIgnoreCase));

    private static T? Annotation<T>(PropertyInfo property, ParameterInfo? parameter)
        where T : Attribute =>
        property.GetCustomAttribute<T>() ?? parameter?.GetCustomAttribute<T>();

    private static bool IsRequired(PropertyInfo property, ParameterInfo? parameter) =>
        Annotation<RequiredAttribute>(property, parameter) is not null
        || property.GetCustomAttribute<RequiredMemberAttribute>() is not null;

    private static void Annotate(JsonObject schema, PropertyInfo property, ParameterInfo? parameter)
    {
        if (schema["description"] is null
            && Annotation<DescriptionAttribute>(property, parameter) is { } described
            && !string.IsNullOrWhiteSpace(described.Description))
        {
            schema["description"] = described.Description;
        }

        string? type = RequestBodyShape.TypeOf(schema["type"]);
        bool array = type == "array";
        bool text = type == "string";
        bool numeric = type is "integer" or "number";

        if (Annotation<StringLengthAttribute>(property, parameter) is { } bounded)
        {
            if (bounded.MinimumLength > 0)
            {
                schema["minLength"] = bounded.MinimumLength;
            }
            schema["maxLength"] = bounded.MaximumLength;
        }
        if (Annotation<MinLengthAttribute>(property, parameter) is { } shortest)
        {
            schema[array ? "minItems" : "minLength"] = shortest.Length;
        }
        if (Annotation<MaxLengthAttribute>(property, parameter) is { } longest)
        {
            schema[array ? "maxItems" : "maxLength"] = longest.Length;
        }
        if (numeric && Annotation<RangeAttribute>(property, parameter) is { } range)
        {
            if (Numeric(range.Minimum) is { } low)
            {
                schema["minimum"] = low;
            }
            if (Numeric(range.Maximum) is { } high)
            {
                schema["maximum"] = high;
            }
        }
        if (text && Annotation<RegularExpressionAttribute>(property, parameter) is { } expression)
        {
            schema["pattern"] = expression.Pattern;
        }
        if (text && schema["format"] is null)
        {
            if (Annotation<EmailAddressAttribute>(property, parameter) is not null)
            {
                schema["format"] = "email";
            }
            else if (Annotation<UrlAttribute>(property, parameter) is not null)
            {
                schema["format"] = "uri";
            }
        }
    }

    private static double? Numeric(object? bound)
    {
        try
        {
            return bound is null ? null : Convert.ToDouble(bound, CultureInfo.InvariantCulture);
        }
        catch (Exception ex) when (ex is FormatException or InvalidCastException or OverflowException)
        {
            return null;
        }
    }

    private static JsonObject Opaque() =>
        new() { ["type"] = "object", ["additionalProperties"] = true };

    private static IEnumerable<PropertyInfo> Declared(Type type) =>
        type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(property => property.GetIndexParameters().Length == 0 && property.CanRead)
            .OrderBy(InheritanceLevel)
            .ThenBy(property => property.MetadataToken);

    private static int InheritanceLevel(PropertyInfo property)
    {
        int level = 0;
        for (Type? declaring = property.DeclaringType?.BaseType;
            declaring is not null;
            declaring = declaring.BaseType)
        {
            level++;
        }
        return level;
    }

    private static bool IsPopulatable(Type type) =>
        type != typeof(string) && typeof(IEnumerable).IsAssignableFrom(type);

    private static bool Binary(Type type) =>
        type == typeof(byte[])
        || type == typeof(Memory<byte>)
        || type == typeof(ReadOnlyMemory<byte>);

    private static bool TryKeySchema(Type key, out JsonObject? schema)
    {
        schema = null;
        Type resolved = Nullable.GetUnderlyingType(key) ?? key;

        if (resolved == typeof(string) || resolved == typeof(char) || resolved == typeof(object))
        {
            return true;
        }
        if (resolved.IsEnum)
        {
            schema = new JsonObject { ["type"] = "string" };
            return true;
        }
        if (Scalar(resolved) is not { } scalar)
        {
            return false;
        }

        JsonObject keySchema = new() { ["type"] = "string" };
        if (scalar["format"] is { } format)
        {
            keySchema["format"] = format.DeepClone();
        }
        else if (scalar["type"]?.GetValue<string>() == "integer")
        {
            keySchema["pattern"] = "^-?[0-9]+$";
        }
        schema = keySchema;
        return true;
    }

    private static MapShape? MapDescriptor(Type type)
    {
        if (ClosedInterface(type, typeof(IDictionary<,>)) is { } writable)
        {
            Type[] arguments = writable.GetGenericArguments();
            return new MapShape(arguments[0], arguments[1]);
        }
        if (ClosedInterface(type, typeof(IReadOnlyDictionary<,>)) is { } readable)
        {
            Type[] arguments = readable.GetGenericArguments();
            return new MapShape(arguments[0], arguments[1]);
        }
        if (typeof(IDictionary).IsAssignableFrom(type))
        {
            return new MapShape(typeof(string), typeof(object));
        }
        return null;
    }

    private static Type? ClosedInterface(Type type, Type definition)
    {
        if (type.IsGenericType && type.GetGenericTypeDefinition() == definition)
        {
            return type;
        }
        foreach (Type contract in type.GetInterfaces())
        {
            if (contract.IsGenericType && contract.GetGenericTypeDefinition() == definition)
            {
                return contract;
            }
        }
        return null;
    }

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
