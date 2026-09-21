using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Search;

internal static class SearchParameters
{
    /// <summary>
    /// Projects a tool's published <c>inputSchema</c> into the terms the search index carries
    /// under <c>parameters</c>: each root property key, and that property's <c>description</c>
    /// when it is a string.
    /// </summary>
    /// <param name="inputSchema">The published schema, or <c>null</c>.</param>
    /// <returns>The terms, in root property order.</returns>
    /// <remarks>
    /// Guard: the schema may be a host-supplied verbatim schema that no validator has seen, so
    /// <c>properties</c>, a member schema and a <c>description</c> can each be any JSON value.
    /// Narrowing each one keeps a malformed schema from throwing during catalog construction, and
    /// keeps this projection identical to <c>searchParameters</c> in the TypeScript core. In
    /// particular <see cref="JsonValue.TryGetValue{T}"/> is used rather than
    /// <c>GetValue&lt;string&gt;()</c>, which throws on a numeric description.
    /// </remarks>
    public static IReadOnlyList<string> From(
        JsonObject? inputSchema, IReadOnlySet<string>? grouped = null)
    {
        if (inputSchema?["properties"] is not JsonObject properties)
        {
            return [];
        }

        List<string> parameters = [];
        foreach ((string name, JsonNode? schema) in properties)
        {
            parameters.Add(name);
            if (schema is not JsonObject member)
            {
                continue;
            }
            if (member["description"] is JsonValue value
                && value.TryGetValue(out string? description))
            {
                parameters.Add(description);
            }
            // Guard: a grouped query object contributes one root key, so its members would stop
            // being searchable and an agent looking for "status" would no longer find the tool
            // that filters by it. Only a deepObject parameter's members are indexed; a nested
            // body object's are not, because a body nests arbitrarily and its members are not
            // addressable filters (nested-and-defs-parameters-not-indexed.json).
            if (grouped?.Contains(name) == true && member["properties"] is JsonObject members)
            {
                parameters.AddRange(members.Select(m => $"{name}.{m.Key}"));
            }
        }
        return parameters;
    }
}
