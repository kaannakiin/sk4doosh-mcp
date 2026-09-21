using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Discovery;

/// <summary>
/// Folds the leaves ApiExplorer expanded out of a whole-object query binding back into one
/// object-valued <see cref="Parameter"/>.
/// </summary>
/// <remarks>
/// Guard: the grouping key is the leaf's <see cref="ApiParameterDescription.ParameterDescriptor"/>
/// by reference, because ApiExplorer builds one visitor per action parameter and stamps that one
/// instance onto every leaf it emits. The descriptor's <c>Name</c> is weaker — a bound controller
/// property and an action parameter can share one — and <c>ModelMetadata.ContainerType</c> is not
/// a key at all, since two action parameters of the same DTO type would collapse into one group.
/// None of this is contracted by ASP.NET; QueryObjectProbeTests pins each fact against the
/// installed shared framework.
/// </remarks>
internal static class QueryObjectGrouper
{
    private static readonly HashSet<string> QueryScalars =
        new(StringComparer.Ordinal) { "string", "integer", "number", "boolean" };

    internal sealed record Plan(
        IReadOnlySet<ApiParameterDescription> Consumed,
        IReadOnlyList<Parameter> Groups);

    internal static readonly Plan Empty = new(new HashSet<ApiParameterDescription>(), []);

    internal static Plan Build(
        ApiDescription api,
        SchemaMapperOptions schema,
        List<CatalogDiagnostic> diagnostics,
        string target)
    {
        HashSet<ApiParameterDescription> consumed = [];
        List<Parameter> groups = [];

        IEnumerable<IGrouping<ParameterDescriptor, ApiParameterDescription>> owned =
            api.ParameterDescriptions
                .Where(leaf => leaf.ParameterDescriptor is not null
                    && EndpointCatalog.Locate(leaf.Source) == "query")
                .GroupBy(leaf => leaf.ParameterDescriptor);

        foreach (IGrouping<ParameterDescriptor, ApiParameterDescription> leaves in owned)
        {
            Type ownerType = Nullable.GetUnderlyingType(leaves.Key.ParameterType)
                ?? leaves.Key.ParameterType;
            if (!leaves.Any(leaf => leaf.ModelMetadata?.ContainerType == ownerType))
            {
                continue;
            }

            string group = leaves.Key.BindingInfo?.BinderModelName ?? leaves.Key.Name;
            List<ApiParameterDescription> expressible = [];
            List<string> dropped = [];
            foreach (ApiParameterDescription leaf in leaves.OrderBy(l => l.Name, StringComparer.Ordinal))
            {
                bool own = leaf.ModelMetadata?.ContainerType == ownerType;
                if (own && Queryable(JsonSchemaMapper.Map(leaf.Type ?? typeof(string), schema)))
                {
                    expressible.Add(leaf);
                }
                else
                {
                    dropped.Add(leaf.Name);
                }
            }

            if (expressible.Count == 0)
            {
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.UnboundQueryObject,
                    $"{target} binds '{group}' as a query object, but no member of '{ownerType.Name}' can be expressed as a query value, so it is not grouped. Flatten the type, or leave Query.Grouping off for this route."));
                continue;
            }

            if (dropped.Count > 0)
            {
                diagnostics.Add(new CatalogDiagnostic(
                    DiagnosticCodes.UnboundQueryObject,
                    $"{target} binds '{group}' as a query object; {string.Join(", ", dropped)} cannot be expressed as query values and are omitted from the '{group}' argument."));
            }

            groups.Add(new Parameter
            {
                Name = group,
                In = "query",
                Required = expressible.Any(leaf => leaf.IsRequired),
                Schema = SchemaFor(expressible, schema),
                Style = "deepObject",
                ObjectNotation = "dot",
            });
            foreach (ApiParameterDescription leaf in leaves)
            {
                consumed.Add(leaf);
            }
        }

        return new Plan(consumed, groups);
    }

    private static JsonObject SchemaFor(
        IReadOnlyList<ApiParameterDescription> members, SchemaMapperOptions schema)
    {
        JsonObject properties = [];
        JsonArray required = [];
        foreach (ApiParameterDescription leaf in members)
        {
            JsonObject member = JsonSchemaMapper.Map(leaf.Type ?? typeof(string), schema);
            if (EndpointCatalog.ParameterDescription(leaf) is { } text && member["description"] is null)
            {
                member["description"] = text;
            }
            properties[leaf.Name] = member;
            if (leaf.IsRequired)
            {
                required.Add((JsonNode)leaf.Name);
            }
        }
        JsonObject group = new() { ["type"] = "object", ["properties"] = properties };
        if (required.Count > 0)
        {
            group["required"] = required;
        }
        group["additionalProperties"] = false;
        return group;
    }

    private static bool Queryable(JsonObject schema)
    {
        if (schema.ContainsKey("$defs") || schema.ContainsKey("$ref"))
        {
            return false;
        }
        string? type = RequestBodyShape.TypeOf(schema["type"]);
        return type == "array"
            ? QueryScalars.Contains(RequestBodyShape.TypeOf(schema["items"]?["type"]) ?? string.Empty)
            : QueryScalars.Contains(type ?? string.Empty);
    }
}
