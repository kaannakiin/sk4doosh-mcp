using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Discovery;

internal sealed class SchemaWriter
{
    private const string IntegerKeyPattern = "^-?[0-9]+$";

    private readonly SchemaWriterOptions options;
    private TypeShape shape = null!;
    private readonly HashSet<string> hoisted = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> names = new(StringComparer.Ordinal);

    public SchemaWriter(SchemaWriterOptions options) => this.options = options;

    public JsonObject Write(TypeShape typeShape)
    {
        shape = typeShape;
        hoisted.Clear();
        names.Clear();

        (Dictionary<string, int> uses, Dictionary<string, List<string>> edges) = BuildGraph();
        foreach ((string key, int count) in uses)
        {
            if (count > 1 || Reaches(edges, key, key))
            {
                hoisted.Add(key);
            }
        }
        AssignNames();

        JsonObject schema = Node(shape.Root, 0, rootInline: true);
        if (hoisted.Count > 0)
        {
            JsonObject bag = [];
            foreach (string key in hoisted
                .OrderBy(key => names[key], StringComparer.Ordinal))
            {
                bag[names[key]] = Body(key, 0);
            }
            schema["$defs"] = bag;
        }
        return schema;
    }

    private (Dictionary<string, int>, Dictionary<string, List<string>>) BuildGraph()
    {
        Dictionary<string, int> uses = new(StringComparer.Ordinal);
        Dictionary<string, List<string>> edges = new(StringComparer.Ordinal);

        List<string> rootRefs = [];
        CollectRefs(shape.Root, rootRefs);
        Queue<string> queue = new(rootRefs);
        foreach (string key in rootRefs)
        {
            Bump(uses, key);
        }

        while (queue.Count > 0)
        {
            string key = queue.Dequeue();
            if (edges.ContainsKey(key))
            {
                continue;
            }
            if (!shape.Types.TryGetValue(key, out ObjectType? declared))
            {
                edges[key] = [];
                continue;
            }
            List<string> refs = [];
            foreach (Member member in declared.Members)
            {
                CollectRefs(member.Type, refs);
            }
            edges[key] = refs;
            foreach (string reference in refs)
            {
                Bump(uses, reference);
                queue.Enqueue(reference);
            }
        }
        return (uses, edges);
    }

    private static void Bump(Dictionary<string, int> uses, string key) =>
        uses[key] = uses.TryGetValue(key, out int count) ? count + 1 : 1;

    private static void CollectRefs(TypeNode node, List<string> into)
    {
        switch (node.Kind)
        {
            case TypeKind.Ref when node.Ref is not null:
                into.Add(node.Ref);
                break;
            case TypeKind.Array when node.Items is not null:
                CollectRefs(node.Items, into);
                break;
            case TypeKind.Map when node.Values is not null:
                CollectRefs(node.Values, into);
                break;
            default:
                break;
        }
    }

    private static bool Reaches(
        Dictionary<string, List<string>> edges, string from, string target)
    {
        HashSet<string> seen = new(StringComparer.Ordinal);
        Queue<string> queue = new(edges.TryGetValue(from, out List<string>? start) ? start : []);
        while (queue.Count > 0)
        {
            string key = queue.Dequeue();
            if (string.Equals(key, target, StringComparison.Ordinal))
            {
                return true;
            }
            if (!seen.Add(key))
            {
                continue;
            }
            if (edges.TryGetValue(key, out List<string>? next))
            {
                foreach (string reference in next)
                {
                    queue.Enqueue(reference);
                }
            }
        }
        return false;
    }

    private void AssignNames()
    {
        Dictionary<string, int> claimed = new(StringComparer.Ordinal);
        foreach (string key in hoisted.OrderBy(key => key, StringComparer.Ordinal))
        {
            string simple = shape.Types.TryGetValue(key, out ObjectType? declared)
                ? declared.Name
                : key;
            int seen = claimed.TryGetValue(simple, out int count) ? count : 0;
            claimed[simple] = seen + 1;
            if (seen == 0)
            {
                names[key] = simple;
                continue;
            }
            string suffixed = $"{simple}_{seen + 1}";
            names[key] = suffixed;
            Report(
                DiagnosticCodes.SchemaDefNameDisambiguated,
                $"Types '{key}' and another type share the simple name '{simple}'; this one is emitted as '{suffixed}'.");
        }
    }

    private void Report(string code, string message) =>
        options.Report?.Invoke(new CatalogDiagnostic(code, message));

    private static JsonObject Opaque() =>
        new() { ["type"] = "object", ["additionalProperties"] = true };

    private bool Truncated(int depth) =>
        options.MaxDepth is { } budget && depth >= budget;

    private JsonObject Node(TypeNode node, int depth, bool rootInline = false)
    {
        switch (node.Kind)
        {
            case TypeKind.Verbatim:
                return node.Schema is null ? [] : (JsonObject)node.Schema.DeepClone();
            case TypeKind.Binary:
                return new JsonObject { ["type"] = "string", ["contentEncoding"] = "base64" };
            case TypeKind.Scalar:
                {
                    JsonObject scalar = new() { ["type"] = Name(node.Scalar ?? ScalarKind.String) };
                    if (node.Format is not null)
                    {
                        scalar["format"] = node.Format;
                    }
                    return scalar;
                }
            case TypeKind.Enum:
                if (node.EnumFacts is null)
                {
                    Report(DiagnosticCodes.UnreadableShape, "An enum node carries no members.");
                    return Opaque();
                }
                return EnumSchema(node.EnumFacts);
            case TypeKind.Map:
                return Map(node, depth);
            case TypeKind.Array:
                return new JsonObject
                {
                    ["type"] = "array",
                    ["items"] = node.Items is null ? Opaque() : Descend(node.Items, depth),
                };
            case TypeKind.Ref:
                return Ref(node, depth, rootInline);
            default:
                Report(
                    DiagnosticCodes.UnreadableShape,
                    node.Reason
                    ?? "The binding layer could not read this type; the shape is unknown.");
                return Opaque();
        }
    }

    private static string Name(ScalarKind kind) => kind switch
    {
        ScalarKind.Boolean => "boolean",
        ScalarKind.Integer => "integer",
        ScalarKind.Number => "number",
        _ => "string",
    };

    public static JsonObject EnumSchemaFor(EnumFacts facts) => EnumSchema(facts);

    private static JsonObject EnumSchema(EnumFacts facts)
    {
        if (facts.WireForm == EnumWireForm.Unresolved)
        {
            if (facts.Combinable == true)
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
                    new JsonObject { ["type"] = "string", ["enum"] = Names(facts) },
                    new JsonObject { ["type"] = "integer", ["enum"] = Numbers(facts) }),
            };
        }

        bool strings = facts.WireForm == EnumWireForm.String;
        JsonObject schema = new() { ["type"] = strings ? "string" : "integer" };
        if (facts.Combinable != true)
        {
            schema["enum"] = strings ? Names(facts) : Numbers(facts);
        }
        return schema;
    }

    private static JsonArray Names(EnumFacts facts)
    {
        JsonArray array = [];
        foreach (string name in facts.Names)
        {
            array.Add(name);
        }
        return array;
    }

    private static JsonArray Numbers(EnumFacts facts)
    {
        JsonArray array = [];
        foreach (int number in facts.Numbers)
        {
            array.Add(number);
        }
        return array;
    }

    private JsonObject Descend(TypeNode node, int depth)
    {
        if (Truncated(depth + 1))
        {
            Report(
                DiagnosticCodes.SchemaDepthTruncated,
                $"The configured depth budget of {options.MaxDepth} cut the shape here.");
            return Opaque();
        }
        return Node(node, depth + 1);
    }

    private JsonObject Map(TypeNode node, int depth)
    {
        if (node.Keys is { Writable: false })
        {
            Report(
                DiagnosticCodes.UnsupportedDictionaryKey,
                "The serializer cannot write this map's key type as a JSON property name; the value shape was dropped.");
            return Opaque();
        }
        JsonObject schema = new()
        {
            ["type"] = "object",
            ["additionalProperties"] =
                node.Values is null ? Opaque() : Descend(node.Values, depth),
        };
        if (node.Keys is { } keys && PropertyNames(keys) is { } propertyNames)
        {
            schema["propertyNames"] = propertyNames;
        }
        return schema;
    }

    private static JsonObject? PropertyNames(MapKey keys)
    {
        if (keys.Scalar is null)
        {
            return null;
        }
        JsonObject schema = new() { ["type"] = "string" };
        if (keys.Format is not null)
        {
            schema["format"] = keys.Format;
        }
        else if (keys.Scalar == ScalarKind.Integer)
        {
            schema["pattern"] = IntegerKeyPattern;
        }
        return schema;
    }

    private JsonObject Ref(TypeNode node, int depth, bool rootInline)
    {
        if (node.Ref is not { } key)
        {
            Report(DiagnosticCodes.UnreadableShape, "A ref node carries no target.");
            return Opaque();
        }
        if (!rootInline && hoisted.Contains(key))
        {
            return new JsonObject { ["$ref"] = $"#/$defs/{names[key]}" };
        }
        return Body(key, depth);
    }

    private JsonObject Body(string key, int depth)
    {
        if (!shape.Types.TryGetValue(key, out ObjectType? declared))
        {
            Report(DiagnosticCodes.UnreadableShape, $"No type is declared for '{key}'.");
            return Opaque();
        }
        return Object(declared, depth);
    }

    private JsonObject Object(ObjectType declared, int depth)
    {
        List<Member> members = [.. declared.Members.Where(Selected)];
        if (declared.Wrapper == true && members.Count == 1)
        {
            Member only = members[0];
            JsonObject unwrapped = Node(only.Type, depth);
            Annotate(unwrapped, only);
            return unwrapped;
        }

        JsonObject properties = [];
        JsonArray required = [];
        foreach (Member member in members)
        {
            JsonObject schema = Descend(member.Type, depth);
            Annotate(schema, member);
            properties[member.Name] = schema;
            if (member.Required)
            {
                required.Add(member.Name);
            }
        }

        JsonObject result = new() { ["type"] = "object", ["properties"] = properties };
        if (required.Count > 0)
        {
            result["required"] = required;
        }
        return result;
    }

    private bool Selected(Member member) =>
        !(options.DropReadOnlyProperties
            && member.ReadOnly
            && !member.ConstructorBound
            && !Populatable(member.Type));

    private static bool Populatable(TypeNode node) =>
        node.Kind is TypeKind.Array or TypeKind.Map;

    private static void Annotate(JsonObject schema, Member member)
    {
        if (member.Description is not null && schema["description"] is null)
        {
            schema["description"] = member.Description;
        }
        if (member.Constraints is not { } constraints)
        {
            return;
        }

        string? type = RequestBodyShape.TypeOf(schema["type"]);
        bool list = type == "array";
        bool text = type == "string";
        bool numeric = type is "integer" or "number";

        if (constraints.MinSize is { } minSize)
        {
            schema[list ? "minItems" : "minLength"] = minSize;
        }
        if (constraints.MaxSize is { } maxSize)
        {
            schema[list ? "maxItems" : "maxLength"] = maxSize;
        }
        if (numeric && constraints.Minimum is { } minimum)
        {
            schema["minimum"] = minimum;
        }
        if (numeric && constraints.Maximum is { } maximum)
        {
            schema["maximum"] = maximum;
        }
        if (text && constraints.Pattern is { } pattern)
        {
            schema["pattern"] = pattern;
        }
        if (text && constraints.Format is { } format && schema["format"] is null)
        {
            schema["format"] = format;
        }
    }
}
