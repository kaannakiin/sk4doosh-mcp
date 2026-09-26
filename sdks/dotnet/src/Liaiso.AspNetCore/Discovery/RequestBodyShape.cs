using System.Text.Json.Nodes;
using Liaiso.AspNetCore.Spec;

namespace Liaiso.AspNetCore.Discovery;

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

    /// <summary>The body-root keys flattening consumes, preserves elsewhere, or drops by rule.</summary>
    /// <remarks>
    /// <c>description</c> is dropped deliberately — flattening leaves no slot for it. <c>$defs</c>
    /// and <c>additionalProperties</c> are carried to the tool root. The rest are consumed.
    /// </remarks>
    private static readonly HashSet<string> FlattenableKeys =
        new(StringComparer.Ordinal)
        {
            "type", "properties", "required", "$defs", "additionalProperties", "description",
        };

    /// <summary>Body-root keys that annotate without constraining, and so must not force root mode.</summary>
    /// <remarks>
    /// The list has to be generous: root mode raises <c>argument_collision</c> when the endpoint
    /// already has a parameter named <c>body</c>, so a key wrongly treated as a constraint turns a
    /// working tool into a dropped one. <c>$schema</c> in particular is written by
    /// <c>zod-to-json-schema</c> and by any standalone serialization, and reaches this predicate
    /// through a host-supplied verbatim schema; it names a dialect, and the only keywords flattening
    /// reads — <c>properties</c> and <c>required</c> — mean the same in every dialect.
    /// <para>
    /// A key that decides <em>where a <c>$ref</c> resolves</em> is never an annotation, however it
    /// reads. <c>$id</c> makes the body root its own schema resource and rebases every reference
    /// inside it; <c>$anchor</c> declares a plain-name fragment that a <c>{"$ref":"#Name"}</c> in a
    /// lifted property points at. Dropping either leaves the references spelled correctly and aimed
    /// at nothing, which is the same defect as a lost <c>$defs</c> bag. Both stay out of this set,
    /// and out of <see cref="FlattenableKeys"/>, so they take the root argument.
    /// </para>
    /// </remarks>
    private static readonly HashSet<string> IgnoredKeys =
        new(StringComparer.Ordinal)
        {
            "title", "$schema", "$comment", "example", "examples",
            "default", "deprecated", "readOnly", "writeOnly",
        };

    /// <summary>Names the body-root key that flattening would silently discard, if there is one.</summary>
    /// <returns>The key, for a diagnostic to name; <c>null</c> when every key is safe.</returns>
    public static string? UnflattenableRootKey(JsonObject schema)
    {
        if (schema["type"] is JsonArray)
        {
            return "type";
        }
        foreach ((string key, JsonNode? _) in schema)
        {
            if (FlattenableKeys.Contains(key)
                || IgnoredKeys.Contains(key)
                || key.StartsWith("x-", StringComparison.Ordinal))
            {
                continue;
            }
            return key;
        }
        return null;
    }

    /// <summary>Names the body field flattening would merge onto a parameter of the same name.</summary>
    /// <remarks>
    /// MCP gives tool arguments one namespace and no <c>in</c>, so a flattened field and a parameter
    /// that share a name would claim one key for two wire slots. Nothing in the descriptor says
    /// whether they denote the same value — <c>POST /orders/{id}</c> with a body field <c>id</c> says
    /// yes, <c>POST /projects/{id}/members/{memberId}</c> with a body field <c>id</c> says no — so
    /// neither reading may be guessed and the body takes the root argument instead.
    /// </remarks>
    /// <returns>The field name, for a diagnostic to name; <c>null</c> when flattening is unambiguous.</returns>
    public static string? CollidingBodyField(JsonObject schema, IEnumerable<string> parameterNames)
    {
        if (schema["properties"] is not JsonObject properties)
        {
            return null;
        }
        HashSet<string> taken = new(parameterNames, StringComparer.Ordinal);
        foreach ((string name, JsonNode? _) in properties)
        {
            if (taken.Contains(name))
            {
                return name;
            }
        }
        return null;
    }

    /// <summary>
    /// Decides whether the body travels as one synthetic argument instead of flattening.
    /// </summary>
    /// <remarks>
    /// Flattening preserves a body root's <c>properties</c> and <c>required</c> and nothing else, so
    /// it is allowed only for a root that carries nothing else worth keeping. The direction is
    /// deliberate: an unrecognised keyword wraps the body rather than dropping the keyword, because a
    /// wrapped body is complete and merely less ergonomic, while a dropped keyword publishes a
    /// contract the backend does not honour. <c>minProperties</c> and <c>propertyNames</c> are the
    /// clearest cases — both count or match <em>every</em> key, and after flattening the tool root's
    /// keys include the path and query parameters. A body declared <c>required: false</c> always
    /// takes the root because a flattened body has no wrapper left to omit and would always send
    /// <c>{}</c>.
    /// </remarks>
    /// <param name="body">The declared request body.</param>
    /// <param name="parameterNames">
    /// The endpoint's parameter names, which flattening would share a namespace with; a field that
    /// collides with one of them forces root mode.
    /// </param>
    /// <returns>Why the body needs a root argument, or <c>null</c> to flatten its fields.</returns>
    public static string? BodyRootReasonOf(RequestBody body, IEnumerable<string>? parameterNames = null)
    {
        if (body.Required == false)
        {
            return "optional";
        }
        if (TypeOf(body.Schema["type"]) is { } type && type != "object")
        {
            return "non_object";
        }
        if (UnflattenableRootKey(body.Schema) is not null)
        {
            return "unflattenable_root";
        }
        if (body.Schema["properties"] is null && !AllowsAdditional(body.Schema))
        {
            return "unflattenable_root";
        }
        return CollidingBodyField(body.Schema, parameterNames ?? []) is null ? null : "collision";
    }

    /// <returns>The synthetic argument name, or <c>null</c> to flatten the body's fields.</returns>
    public static string? BodyRootOf(RequestBody body, IEnumerable<string>? parameterNames = null) =>
        BodyRootReasonOf(body, parameterNames) is null ? null : BodyRootArgument;

    /// <summary>Reads a body's <c>additionalProperties</c> as the tool root should write it.</summary>
    /// <remarks>
    /// A body that types its extra keys says more than "extra keys are allowed", and the tool root
    /// can carry that verbatim: <c>additionalProperties</c> constrains only keys absent from
    /// <c>properties</c>, and every parameter is named there, so lifting the rule cannot reach them.
    /// </remarks>
    /// <returns>The value schema as a detached clone, or the boolean <see cref="AllowsAdditional"/> reports.</returns>
    public static JsonNode AdditionalPropertiesOf(JsonObject schema) =>
        schema["additionalProperties"] is JsonObject typed
            ? typed.DeepClone()
            : AllowsAdditional(schema);

    public static bool AllowsAdditional(JsonObject schema) => schema["additionalProperties"] switch
    {
        null => false,
        JsonValue value when value.TryGetValue(out bool flag) => flag,
        _ => true,
    };
}
