using System.Collections;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Discovery;

internal sealed class TypeShapeBinder
{
    private readonly record struct MapShape(Type Key, Type Value);

    private readonly TypeShapeBinderOptions options;
    private readonly Dictionary<string, ObjectType> types = new(StringComparer.Ordinal);
    private readonly Dictionary<Type, string> keys = [];

    private TypeShapeBinder(TypeShapeBinderOptions options) => this.options = options;

    public static TypeShape Bind(Type type, TypeShapeBinderOptions options)
    {
        TypeShapeBinder binder = new(options);
        TypeNode root = binder.Node(type, null);
        return new TypeShape { Root = root, Types = binder.types };
    }

    private TypeNode Node(Type type, PropertyInfo? owner)
    {
        Type resolved = Nullable.GetUnderlyingType(type) ?? type;

        if (owner is not null && options.PropertySchema?.Invoke(owner) is { } declared)
        {
            return new TypeNode { Kind = TypeKind.Verbatim, Schema = declared };
        }
        if (options.TypeSchema?.Invoke(resolved) is { } supplied)
        {
            return new TypeNode { Kind = TypeKind.Verbatim, Schema = supplied };
        }
        if (Binary(resolved))
        {
            return new TypeNode { Kind = TypeKind.Binary };
        }
        if (Scalar(resolved) is { } scalar)
        {
            return scalar;
        }
        if (resolved.IsEnum)
        {
            return new TypeNode
            {
                Kind = TypeKind.Enum,
                EnumFacts = options.EnumShape is { } describe
                    ? describe(resolved)
                    : EnumWireFormat.Describe(resolved, JsonSerializerOptions.Default),
            };
        }
        if (MapDescriptor(resolved) is { } shape)
        {
            return new TypeNode
            {
                Kind = TypeKind.Map,
                Keys = KeyOf(shape.Key),
                Values = Node(shape.Value, null),
            };
        }
        if (ItemType(resolved) is { } item)
        {
            return new TypeNode { Kind = TypeKind.Array, Items = Node(item, null) };
        }
        if (resolved == typeof(object))
        {
            return new TypeNode
            {
                Kind = TypeKind.Unknown,
                Reason = "'object' carries no readable shape; any JSON value is accepted.",
            };
        }
        return new TypeNode { Kind = TypeKind.Ref, Ref = Declare(resolved) };
    }

    private string Declare(Type type)
    {
        if (keys.TryGetValue(type, out string? existing))
        {
            return existing;
        }

        string key = type.FullName ?? type.Name;
        keys[type] = key;
        types[key] = new ObjectType { Name = SimpleName(type), Members = [] };

        List<Member> members = [];
        ConstructorInfo? primary = PrimaryConstructor(type);
        foreach (PropertyInfo property in Declared(type))
        {
            ParameterInfo? parameter = Correlate(primary, property);
            members.Add(new Member
            {
                Name = options.PropertyName(property),
                Type = Node(property.PropertyType, property),
                Required = IsRequired(property, parameter),
                ReadOnly = !property.CanWrite,
                ConstructorBound = parameter is not null,
                Description = DescriptionOf(property, parameter),
                Constraints = ConstraintsOf(property, parameter),
            });
        }
        types[key] = new ObjectType { Name = SimpleName(type), Members = members };
        return key;
    }

    private string SimpleName(Type type)
    {
        if (options.TypeName?.Invoke(type) is { } declared && declared.Length > 0)
        {
            return declared;
        }
        string name = type.Name;
        int tick = name.IndexOf('`', StringComparison.Ordinal);
        return tick < 0 ? name : name[..tick];
    }

    private MapKey KeyOf(Type key)
    {
        Type resolved = Nullable.GetUnderlyingType(key) ?? key;

        if (resolved == typeof(string) || resolved == typeof(char) || resolved == typeof(object))
        {
            return new MapKey { Writable = true };
        }
        if (resolved.IsEnum)
        {
            return new MapKey { Writable = true, Scalar = ScalarKind.String };
        }
        if (Scalar(resolved) is not { } scalar)
        {
            options.Report?.Invoke(new CatalogDiagnostic(
                DiagnosticCodes.UnsupportedDictionaryKey,
                $"A map is keyed by '{resolved.Name}', which the serializer cannot write as a JSON property name; the value shape was dropped."));
            return new MapKey { Writable = false };
        }
        return new MapKey
        {
            Writable = true,
            Scalar = scalar.Scalar ?? ScalarKind.String,
            Format = scalar.Format,
        };
    }

    private static Constraints? ConstraintsOf(PropertyInfo property, ParameterInfo? parameter)
    {
        int? minSize = null;
        int? maxSize = null;
        double? minimum = null;
        double? maximum = null;
        string? pattern = null;
        string? format = null;

        if (Annotation<StringLengthAttribute>(property, parameter) is { } bounded)
        {
            if (bounded.MinimumLength > 0)
            {
                minSize = bounded.MinimumLength;
            }
            maxSize = bounded.MaximumLength;
        }
        if (Annotation<MinLengthAttribute>(property, parameter) is { } shortest)
        {
            minSize = shortest.Length;
        }
        if (Annotation<MaxLengthAttribute>(property, parameter) is { } longest)
        {
            maxSize = longest.Length;
        }
        if (Annotation<RangeAttribute>(property, parameter) is { } range)
        {
            minimum = Numeric(range.Minimum);
            maximum = Numeric(range.Maximum);
        }
        if (Annotation<RegularExpressionAttribute>(property, parameter) is { } expression)
        {
            pattern = expression.Pattern;
        }
        if (Annotation<EmailAddressAttribute>(property, parameter) is not null)
        {
            format = "email";
        }
        else if (Annotation<UrlAttribute>(property, parameter) is not null)
        {
            format = "uri";
        }

        if (minSize is null && maxSize is null && minimum is null
            && maximum is null && pattern is null && format is null)
        {
            return null;
        }
        return new Constraints
        {
            MinSize = minSize,
            MaxSize = maxSize,
            Minimum = minimum,
            Maximum = maximum,
            Pattern = pattern,
            Format = format,
        };
    }

    private static string? DescriptionOf(PropertyInfo property, ParameterInfo? parameter) =>
        Annotation<DescriptionAttribute>(property, parameter) is { } described
        && !string.IsNullOrWhiteSpace(described.Description)
            ? described.Description
            : null;

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

    private static bool Binary(Type type) =>
        type == typeof(byte[])
        || type == typeof(Memory<byte>)
        || type == typeof(ReadOnlyMemory<byte>);

    private static TypeNode? Scalar(Type type)
    {
        if (type == typeof(string) || type == typeof(char))
        {
            return Value(ScalarKind.String);
        }
        if (type == typeof(bool))
        {
            return Value(ScalarKind.Boolean);
        }
        if (type == typeof(byte) || type == typeof(sbyte) || type == typeof(short)
            || type == typeof(ushort) || type == typeof(int) || type == typeof(uint)
            || type == typeof(long) || type == typeof(ulong))
        {
            return Value(ScalarKind.Integer);
        }
        if (type == typeof(float) || type == typeof(double) || type == typeof(decimal))
        {
            return Value(ScalarKind.Number);
        }
        if (type == typeof(Guid))
        {
            return Value(ScalarKind.String, "uuid");
        }
        if (type == typeof(DateTime) || type == typeof(DateTimeOffset))
        {
            return Value(ScalarKind.String, "date-time");
        }
        if (type == typeof(DateOnly))
        {
            return Value(ScalarKind.String, "date");
        }
        if (type == typeof(TimeOnly) || type == typeof(TimeSpan) || type == typeof(Uri))
        {
            return Value(ScalarKind.String);
        }
        return null;
    }

    private static TypeNode Value(ScalarKind kind, string? format = null) =>
        new() { Kind = TypeKind.Scalar, Scalar = kind, Format = format };

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
