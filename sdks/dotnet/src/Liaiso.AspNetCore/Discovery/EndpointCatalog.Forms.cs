using System.Text.Json.Nodes;
using Liaiso.AspNetCore.Requests;
using Liaiso.AspNetCore.Spec;

namespace Liaiso.AspNetCore.Discovery;

internal static partial class EndpointCatalog
{
    private static readonly HashSet<string> FormScalars = new(StringComparer.Ordinal)
    {
        "string", "integer", "number", "boolean",
    };

    /// <summary>A property the descriptor marks as a file part: <c>contentMediaType</c> and no <c>contentEncoding</c>.</summary>
    internal static bool IsFileSchema(JsonNode? schema) =>
        schema is JsonObject o && o["contentMediaType"] is JsonValue && o["contentEncoding"] is null;

    internal static bool IsFileArraySchema(JsonNode? schema) =>
        RequestBodyShape.TypeOf(schema?["type"]) == "array" && IsFileSchema(schema?["items"]);

    private static bool IsFormScalar(JsonNode? schema) =>
        schema is JsonObject o
        && RequestBodyShape.TypeOf(o["type"]) is { } type
        && FormScalars.Contains(type)
        && o["$ref"] is null
        && o["$defs"] is null;

    private static FormFieldKind FormKind(string? type) => type switch
    {
        "integer" => FormFieldKind.Integer,
        "number" => FormFieldKind.Number,
        "boolean" => FormFieldKind.Boolean,
        _ => FormFieldKind.String,
    };

    /// <remarks>The twin is <c>formFieldFor</c> in packages/http/core/src/tool.ts.</remarks>
    private static FormField FormFieldFor(string name, JsonNode? schema)
    {
        if (IsFileSchema(schema))
        {
            return new FormField(name, FormFieldKind.File, MediaType: schema!["contentMediaType"]!.GetValue<string>());
        }
        if (IsFileArraySchema(schema))
        {
            return new FormField(
                name, FormFieldKind.File, IsArray: true,
                MediaType: schema!["items"]!["contentMediaType"]!.GetValue<string>());
        }
        if (IsFormScalar(schema))
        {
            return new FormField(name, FormKind(RequestBodyShape.TypeOf(schema!["type"])));
        }
        string? type = RequestBodyShape.TypeOf(schema?["type"]);
        if (type == "array" && IsFormScalar(schema?["items"]))
        {
            return new FormField(name, FormKind(RequestBodyShape.TypeOf(schema!["items"]!["type"])), IsArray: true);
        }
        if (type == "object" && schema?["$ref"] is null && schema?["properties"] is JsonObject properties)
        {
            List<ObjectMember> members = [];
            foreach ((string member, JsonNode? memberSchema) in properties)
            {
                bool isArray = RequestBodyShape.TypeOf(memberSchema?["type"]) == "array";
                JsonNode? scalar = isArray ? memberSchema?["items"] : memberSchema;
                if (!IsFormScalar(scalar))
                {
                    throw new LiaisoTemplateException(
                        LiaisoTemplateException.UnsupportedBodyShape,
                        $"Member '{name}.{member}' is not a form scalar or an array of them; a form body carries one level of nesting.");
                }
                members.Add(new ObjectMember(member, Kind(RequestBodyShape.TypeOf(scalar!["type"])), isArray));
            }
            return new FormField(name, FormFieldKind.Object, Members: members);
        }
        throw new LiaisoTemplateException(
            LiaisoTemplateException.UnsupportedBodyShape,
            $"Field '{name}' is not a form scalar, an array of them, a one-level object or a file.");
    }

    /// <summary>Freezes a form or multipart body's field list from the descriptor.</summary>
    /// <param name="properties">The flattened body's properties, or the body root's own in root mode.</param>
    private static FormBinding FormBindingFor(RequestBody body, JsonObject? properties)
    {
        if (properties is null)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedBodyShape,
                $"A {body.ContentType} body must be an object with declared properties.");
        }
        return new FormBinding(
            body.ObjectNotation == "dot" ? ObjectNotation.Dot : ObjectNotation.Bracket,
            [.. properties.Select(entry => FormFieldFor(entry.Key, entry.Value))]);
    }

    internal static IReadOnlySet<FileSource> FileSourcesOf(string? refDescription) =>
        refDescription is null
            ? RequestTemplate.DefaultFileSources
            : new HashSet<FileSource> { FileSource.Text, FileSource.Base64, FileSource.Ref };
}
