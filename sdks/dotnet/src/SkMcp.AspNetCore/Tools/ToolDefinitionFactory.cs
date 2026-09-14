using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Naming;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Tools;

internal static class ToolDefinitionFactory
{
    public static ToolDefinition Create(
        EndpointDescriptor endpoint, bool strictArguments = true, string? name = null)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        return new ToolDefinition
        {
            Name = name ?? ToolNameFactory.Create(endpoint),
            Description = string.IsNullOrWhiteSpace(endpoint.Description)
                ? $"{endpoint.Method} {endpoint.Route}"
                : endpoint.Description,
            InputSchema = BuildInputSchema(endpoint, strictArguments),
            Annotations = Annotate(endpoint.Method),
            Auth = endpoint.Auth,
        };
    }

    private static JsonObject BuildInputSchema(EndpointDescriptor endpoint, bool strictArguments)
    {
        JsonObject properties = [];
        JsonArray required = [];
        HashSet<string> claimed = new(StringComparer.Ordinal);

        void Require(string name)
        {
            if (claimed.Add(name))
            {
                required.Add(name);
            }
        }

        foreach (Parameter parameter in endpoint.Parameters ?? [])
        {
            properties[parameter.Name] = Describe(parameter.Schema, parameter.Description);
            if (parameter.Required)
            {
                Require(parameter.Name);
            }
        }

        JsonNode additionalProperties = false;
        string? root = endpoint.RequestBody is null
            ? null
            : RequestBodyShape.BodyRootOf(endpoint.RequestBody);
        JsonObject? seed = null;
        if (endpoint.RequestBody is not null && root is { } bodyRoot)
        {
            if (strictArguments && properties.ContainsKey(bodyRoot))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.ArgumentCollision,
                    $"Body root argument '{bodyRoot}' collides with a parameter name on {endpoint.Method} {endpoint.Route}; rename the parameter.");
            }
            properties[bodyRoot] = endpoint.RequestBody.Schema.DeepClone();
            if (endpoint.RequestBody.Required != false)
            {
                Require(bodyRoot);
            }
        }
        else if (endpoint.RequestBody is not null)
        {
            JsonObject body = endpoint.RequestBody.Schema;
            additionalProperties = RequestBodyShape.AdditionalPropertiesOf(body);
            seed = body["$defs"] as JsonObject;

            if (body["properties"] is JsonObject bodyProperties)
            {
                foreach ((string name, JsonNode? schema) in bodyProperties)
                {
                    if (strictArguments && properties.ContainsKey(name))
                    {
                        throw new SkMcpTemplateException(
                            SkMcpTemplateException.ArgumentCollision,
                            $"Body property '{name}' collides with a parameter name on {endpoint.Method} {endpoint.Route}; rename one of them.");
                    }
                    properties[name] = schema?.DeepClone();
                }
            }
            if (body["required"] is JsonArray bodyRequired)
            {
                foreach (JsonNode? name in bodyRequired)
                {
                    if (name?.GetValue<string>() is { } entry && properties.ContainsKey(entry))
                    {
                        Require(entry);
                    }
                }
            }
        }

        JsonObject result = new()
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["required"] = required,
            ["additionalProperties"] = additionalProperties,
        };
        if (LiftDefs(properties, seed, endpoint) is { } defs)
        {
            result["$defs"] = defs;
        }
        return result;
    }

    /// <summary>Merges every <c>$defs</c> bag reachable from the tool's own root into one.</summary>
    /// <param name="seed">
    /// The flattened body's own root bag. A flattened body contributes its properties to
    /// <paramref name="properties"/> but its root — and so its bag — is never emitted, so without
    /// this the <c>$ref</c>s lifted out of it would point at nothing. Its entries are cloned and the
    /// bag itself is never detached: the descriptor is shared across the catalog snapshot, and
    /// stripping <c>$defs</c> from it would break every tool built after the first.
    /// </param>
    /// <exception cref="SkMcpTemplateException">
    /// <c>schema_def_conflict</c> when one key carries two different schemas.
    /// </exception>
    private static JsonObject? LiftDefs(
        JsonObject properties, JsonObject? seed, EndpointDescriptor endpoint)
    {
        SortedDictionary<string, JsonNode> merged = new(StringComparer.Ordinal);
        void Take(string name, JsonNode body)
        {
            if (merged.TryGetValue(name, out JsonNode? existing))
            {
                if (!JsonNode.DeepEquals(existing, body))
                {
                    throw new SkMcpTemplateException(
                        DiagnosticCodes.SchemaDefConflict,
                        $"Two schemas on {endpoint.Method} {endpoint.Route} define '{name}' differently; the tool cannot be built.");
                }
                return;
            }
            merged[name] = body.DeepClone();
        }

        foreach ((string name, JsonNode? body) in seed ?? [])
        {
            if (body is not null)
            {
                Take(name, body);
            }
        }
        foreach ((string _, JsonNode? node) in properties)
        {
            if (node is not JsonObject owner || owner["$defs"] is not JsonObject own)
            {
                continue;
            }
            owner.Remove("$defs");
            foreach ((string name, JsonNode? body) in own)
            {
                if (body is not null)
                {
                    Take(name, body);
                }
            }
        }
        if (merged.Count == 0)
        {
            return null;
        }
        JsonObject bag = [];
        foreach ((string name, JsonNode body) in merged)
        {
            bag[name] = body;
        }
        return bag;
    }

    private static JsonNode Describe(JsonObject schema, string? description)
    {
        JsonObject clone = (JsonObject)schema.DeepClone();
        if (!string.IsNullOrWhiteSpace(description) && clone["description"] is null)
        {
            clone["description"] = description;
        }
        return clone;
    }

    private static ToolAnnotations Annotate(string method) => method.ToUpperInvariant() switch
    {
        "GET" or "HEAD" => new ToolAnnotations { ReadOnlyHint = true, IdempotentHint = true },
        "POST" => new ToolAnnotations { DestructiveHint = false },
        "PUT" => new ToolAnnotations { DestructiveHint = true, IdempotentHint = true },
        "PATCH" => new ToolAnnotations { DestructiveHint = true },
        "DELETE" => new ToolAnnotations { DestructiveHint = true, IdempotentHint = true },
        _ => new ToolAnnotations(),
    };
}
