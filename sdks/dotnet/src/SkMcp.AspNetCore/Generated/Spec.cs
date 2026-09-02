using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Spec;

public sealed record EndpointDescriptor
{
    public string? OperationId { get; init; }
    public string? Container { get; init; }
    public required string Method { get; init; }
    public required string Route { get; init; }
    public string? Description { get; init; }
    public IReadOnlyList<Parameter>? Parameters { get; init; }
    public RequestBody? RequestBody { get; init; }
    public IReadOnlyDictionary<string, ResponseBody>? Responses { get; init; }
    public required Auth Auth { get; init; }
    public IReadOnlyList<string>? Tags { get; init; }
}

public sealed record Parameter
{
    public required string Name { get; init; }
    public required string In { get; init; }
    public required bool Required { get; init; }
    public required JsonObject Schema { get; init; }
    public string? Description { get; init; }
}

public sealed record RequestBody
{
    public required JsonObject Schema { get; init; }
    public string? Description { get; init; }
}

public sealed record ResponseBody
{
    public JsonObject? Schema { get; init; }
    public string? Description { get; init; }
}

public sealed record Auth
{
    public required bool Anonymous { get; init; }
    public required IReadOnlyList<string> Policies { get; init; }
    public required bool Imperative { get; init; }
}

public sealed record ToolDefinition
{
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required JsonObject InputSchema { get; init; }
    public required ToolAnnotations Annotations { get; init; }
    public required Auth Auth { get; init; }
}

public sealed record ToolAnnotations
{
    public bool? ReadOnlyHint { get; init; }
    public bool? DestructiveHint { get; init; }
    public bool? IdempotentHint { get; init; }
}
