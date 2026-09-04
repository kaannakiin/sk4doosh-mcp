using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Naming;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Tools;

internal static class ToolDefinitionFactory
{
    public static ToolDefinition Create(EndpointDescriptor endpoint, bool strictArguments = true)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        return new ToolDefinition
        {
            Name = ToolNameFactory.Create(endpoint),
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
        if (endpoint.RequestBody is not null)
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

        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["required"] = required,
            ["additionalProperties"] = allowsAdditional,
        };
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
