using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Naming;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Tools;

public static class ToolDefinitionFactory
{
    public static ToolDefinition Create(EndpointDescriptor endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        return new ToolDefinition
        {
            Name = ToolNameFactory.Create(endpoint),
            Description = string.IsNullOrWhiteSpace(endpoint.Description)
                ? $"{endpoint.Method} {endpoint.Route}"
                : endpoint.Description,
            InputSchema = BuildInputSchema(endpoint),
            Annotations = Annotate(endpoint.Method),
            Auth = endpoint.Auth,
        };
    }

    private static JsonObject BuildInputSchema(EndpointDescriptor endpoint)
    {
        JsonObject properties = [];
        JsonArray required = [];

        foreach (Parameter parameter in endpoint.Parameters ?? [])
        {
            properties[parameter.Name] = Describe(parameter.Schema, parameter.Description);
            if (parameter.Required)
            {
                required.Add(parameter.Name);
            }
        }

        if (endpoint.RequestBody is not null)
        {
            JsonObject body = endpoint.RequestBody.Schema;
            if (body["properties"] is JsonObject bodyProperties)
            {
                foreach ((string name, JsonNode? schema) in bodyProperties)
                {
                    properties[name] = schema?.DeepClone();
                }
            }
            if (body["required"] is JsonArray bodyRequired)
            {
                foreach (JsonNode? name in bodyRequired)
                {
                    required.Add(name?.DeepClone());
                }
            }
        }

        return new JsonObject
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["required"] = required,
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
