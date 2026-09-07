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

        bool allowsAdditional = false;
        if (endpoint.RequestBody is not null
            && RequestBodyShape.BodyRootOf(endpoint.RequestBody.Schema) is { } bodyRoot)
        {
            if (strictArguments && properties.ContainsKey(bodyRoot))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.ArgumentCollision,
                    $"Body root argument '{bodyRoot}' collides with a parameter name on {endpoint.Method} {endpoint.Route}; rename the parameter.");
            }
            properties[bodyRoot] = endpoint.RequestBody.Schema.DeepClone();
            Require(bodyRoot);
        }
        else if (endpoint.RequestBody is not null)
        {
            JsonObject body = endpoint.RequestBody.Schema;
            allowsAdditional = RequestBodyShape.AllowsAdditional(body);

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
            ["additionalProperties"] = allowsAdditional,
        };
        if (LiftDefs(properties, endpoint) is { } defs)
        {
            result["$defs"] = defs;
        }
        return result;
    }

    private static JsonObject? LiftDefs(JsonObject properties, EndpointDescriptor endpoint)
    {
        SortedDictionary<string, JsonNode> merged = new(StringComparer.Ordinal);
        foreach ((string _, JsonNode? node) in properties)
        {
            if (node is not JsonObject owner || owner["$defs"] is not JsonObject own)
            {
                continue;
            }
            owner.Remove("$defs");
            foreach ((string name, JsonNode? body) in own)
            {
                if (body is null)
                {
                    continue;
                }
                if (merged.TryGetValue(name, out JsonNode? existing))
                {
                    if (!JsonNode.DeepEquals(existing, body))
                    {
                        throw new SkMcpTemplateException(
                            DiagnosticCodes.SchemaDefConflict,
                            $"Two schemas on {endpoint.Method} {endpoint.Route} define '{name}' differently; the tool cannot be built.");
                    }
                    continue;
                }
                merged[name] = body.DeepClone();
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
