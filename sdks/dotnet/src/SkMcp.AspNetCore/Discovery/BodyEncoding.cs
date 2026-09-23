using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using SkMcp.AspNetCore.Requests;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Discovery;

/// <summary>Chooses a body's media type and rebuilds a form body from the leaves ApiExplorer flattened it into.</summary>
internal static class BodyEncoding
{
    private static readonly JsonObject FilePart = new()
    {
        ["type"] = "string",
        ["contentMediaType"] = "application/octet-stream",
    };

    private static string MediaTypeOf(string value) =>
        value.Split(';')[0].Trim().ToLowerInvariant();

    private static bool Covers(string accepted, string mediaType) =>
        accepted == mediaType
        || accepted == "*/*"
        || (accepted.EndsWith("/*", StringComparison.Ordinal)
            && mediaType.StartsWith(accepted[..^1], StringComparison.Ordinal));

    private static bool IsWritable(string mediaType) =>
        MediaTypes.IsJson(mediaType) || MediaTypes.IsForm(mediaType) || mediaType == MediaTypes.Text;

    /// <summary>What the endpoint accepts, as the pipeline enforces it.</summary>
    /// <remarks>
    /// Guard: <c>[Consumes]</c> and minimal-API accepts metadata are read off the endpoint, never
    /// off <c>SupportedRequestFormats</c> alone. ApiExplorer keeps a formatter type only when it is
    /// a subset of the declared one, so <c>[Consumes("application/merge-patch+json")]</c> leaves the
    /// list empty (FormBindingProbeTests.P2) while the pipeline answers <c>application/json</c> with
    /// 415 (P3).
    /// </remarks>
    private static IReadOnlyList<string> AcceptedOf(ApiDescription api, IReadOnlyList<object> metadata)
    {
        IAcceptsMetadata? accepts = metadata.OfType<IAcceptsMetadata>().LastOrDefault();
        if (accepts is { ContentTypes.Count: > 0 })
        {
            return [.. accepts.ContentTypes.Select(MediaTypeOf)];
        }
        return [.. api.SupportedRequestFormats.Select(format => MediaTypeOf(format.MediaType))];
    }

    private static string? DeclaredConsumes(IReadOnlyList<object> metadata) =>
        metadata.OfType<McpToolAttribute>().LastOrDefault(attribute => attribute.Consumes is not null)?.Consumes;

    /// <summary>Chooses among JSON-body media types.</summary>
    /// <returns><c>null</c> for <c>application/json</c>; the media type otherwise.</returns>
    /// <remarks>
    /// The order is the spec's, not the list's: every accepted type is correct, so choosing one is
    /// not a conflict, and "first declared" would make the tool depend on the order of a list
    /// nobody wrote for it.
    /// </remarks>
    public static bool TryChooseJson(
        ApiDescription api, IReadOnlyList<object> metadata, bool isString,
        string where, List<CatalogDiagnostic> diagnostics, out string? contentType)
    {
        IReadOnlyList<string> accepted = AcceptedOf(api, metadata);
        contentType = null;
        if (DeclaredConsumes(metadata) is { } declared)
        {
            string chosen = MediaTypeOf(declared);
            if (accepted.Count > 0 && !accepted.Any(type => Covers(type, chosen)))
            {
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.ContentTypeNotAccepted,
                    $"{where} declares Consumes '{chosen}', which the endpoint does not accept ({string.Join(", ", accepted)}); endpoint skipped."));
                return false;
            }
            return Settle(chosen, where, diagnostics, out contentType);
        }
        if (accepted.Count == 0 || accepted.Any(type => Covers(type, MediaTypes.Json)))
        {
            return true;
        }
        string[] concrete = [.. accepted.Where(type => !type.Contains('*'))];
        string? json = concrete.FirstOrDefault(MediaTypes.IsJson);
        if (json is not null)
        {
            contentType = json;
            return true;
        }
        if (isString && concrete.Contains(MediaTypes.Text))
        {
            contentType = MediaTypes.Text;
            return true;
        }
        return Settle(concrete.FirstOrDefault() ?? accepted[0], where, diagnostics, out contentType);
    }

    private static bool Settle(string chosen, string where, List<CatalogDiagnostic> diagnostics, out string? contentType)
    {
        contentType = chosen == MediaTypes.Json ? null : chosen;
        if (!IsWritable(chosen))
        {
            diagnostics.Add(new CatalogDiagnostic(
                DiagnosticCodes.UnsupportedBinding,
                $"{where} takes a {chosen} body, which sk-mcp has no writer for; endpoint skipped."));
            return false;
        }
        return true;
    }

    private static bool IsFileType(Type? type) =>
        type is not null && typeof(IFormFile).IsAssignableFrom(type);

    private static bool IsFileCollection(Type? type) =>
        type is not null
        && (typeof(IFormFileCollection).IsAssignableFrom(type)
            || (type != typeof(string)
                && type.GetInterfaces().Append(type)
                    .Any(candidate => candidate.IsGenericType
                        && candidate.GetGenericTypeDefinition() == typeof(IEnumerable<>)
                        && IsFileType(candidate.GetGenericArguments()[0]))));

    private static JsonObject LeafSchema(ApiParameterDescription leaf, SchemaMapperOptions schema)
    {
        if (IsFileType(leaf.Type))
        {
            return (JsonObject)FilePart.DeepClone();
        }
        if (IsFileCollection(leaf.Type))
        {
            return new JsonObject { ["type"] = "array", ["items"] = FilePart.DeepClone() };
        }
        return JsonSchemaMapper.Map(leaf.Type ?? typeof(string), schema);
    }

    private static string DropReason(string where, string detail) =>
        $"{where} binds a form {detail}; endpoint skipped.";

    /// <summary>Rebuilds a form body from its leaves and chooses its media type.</summary>
    /// <remarks>
    /// Names come from ApiExplorer, which reports the binder's names (FormBindingProbeTests.P4),
    /// not the JSON naming policy. A dotted leaf regroups one level under its first segment, and
    /// the notation is <c>dot</c> because that is what <c>[FromQuery]</c> grouping writes too
    /// (P6 shows the form binder reads both).
    /// </remarks>
    /// <returns>The body, or <c>null</c> when the endpoint has to be dropped; the reason has been reported.</returns>
    public static RequestBody? FormBodyOf(
        ApiDescription api,
        IReadOnlyList<object> metadata,
        IReadOnlyList<ApiParameterDescription> leaves,
        SchemaMapperOptions schema,
        string where,
        List<CatalogDiagnostic> diagnostics)
    {
        if (metadata.OfType<IAntiforgeryMetadata>().LastOrDefault() is { RequiresValidation: true })
        {
            diagnostics.Add(new CatalogDiagnostic(
                DiagnosticCodes.FormAntiforgeryRequired,
                $"{where} requires antiforgery validation, which a synthetic request cannot pass and sk-mcp does not bypass. Opt the endpoint out with .DisableAntiforgery() if it is not reached from a browser; endpoint skipped."));
            return null;
        }
        if (leaves.Any(leaf => leaf.Type is { } type && typeof(IFormCollection).IsAssignableFrom(type)))
        {
            diagnostics.Add(new CatalogDiagnostic(
                DiagnosticCodes.UnsupportedBodyShape,
                DropReason(where, "collection, whose fields cannot be read")));
            return null;
        }

        JsonObject properties = [];
        JsonArray required = [];
        bool hasFiles = false;
        foreach (ApiParameterDescription leaf in leaves)
        {
            string name = leaf.Name;
            if (leaf.ParameterDescriptor?.BindingInfo?.BinderModelName is { Length: > 0 } prefix
                && leaf.ModelMetadata?.ContainerType is not null)
            {
                name = $"{prefix}.{name}";
            }
            string[] segments = name.Split('.');
            if (segments.Length > 2)
            {
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.UnsupportedBodyShape,
                    DropReason(where, $"field '{name}' nested more than one level deep")));
                return null;
            }
            JsonObject leafSchema = LeafSchema(leaf, schema);
            hasFiles |= EndpointCatalog.IsFileSchema(leafSchema) || EndpointCatalog.IsFileArraySchema(leafSchema);
            if (segments.Length == 1)
            {
                properties[name] = leafSchema;
                if (leaf.IsRequired)
                {
                    required.Add(name);
                }
                continue;
            }
            if (properties[segments[0]] is not JsonObject group)
            {
                group = new JsonObject { ["type"] = "object", ["properties"] = new JsonObject() };
                properties[segments[0]] = group;
            }
            ((JsonObject)group["properties"]!)[segments[1]] = leafSchema;
        }

        IReadOnlyList<string> accepted = AcceptedOf(api, metadata);
        string contentType;
        if (DeclaredConsumes(metadata) is { } declared)
        {
            contentType = MediaTypeOf(declared);
            if (accepted.Count > 0 && !accepted.Any(type => Covers(type, contentType)))
            {
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.ContentTypeNotAccepted,
                    $"{where} declares Consumes '{contentType}', which the endpoint does not accept ({string.Join(", ", accepted)}); endpoint skipped."));
                return null;
            }
        }
        else if (hasFiles || (accepted.Contains(MediaTypes.Multipart) && !accepted.Contains(MediaTypes.UrlEncoded)))
        {
            contentType = MediaTypes.Multipart;
        }
        else
        {
            contentType = MediaTypes.UrlEncoded;
        }
        if (!MediaTypes.IsForm(contentType) || (hasFiles && contentType != MediaTypes.Multipart))
        {
            diagnostics.Add(new CatalogDiagnostic(
                DiagnosticCodes.ContentTypeNotAccepted,
                $"{where} binds form fields{(hasFiles ? " and a file" : string.Empty)}, which a {contentType} body cannot carry; endpoint skipped."));
            return null;
        }

        JsonObject body = new() { ["type"] = "object", ["properties"] = properties };
        if (required.Count > 0)
        {
            body["required"] = required;
        }
        return new RequestBody { Schema = body, ContentType = contentType, ObjectNotation = "dot" };
    }
}
