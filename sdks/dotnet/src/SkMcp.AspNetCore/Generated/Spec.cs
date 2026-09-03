using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Spec;

public sealed record EndpointDescriptor
{
    public string? OperationId { get; init; }
    public string? Container { get; init; }
    public string? ContainerPrefix { get; init; }
    public string? ToolName { get; init; }
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
    public required Anonymity Anonymous { get; init; }
    public required IReadOnlyList<string> Policies { get; init; }
    public required bool Imperative { get; init; }
}

public enum Anonymity { Yes, No, Unknown }

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

public enum BackendErrorCode { ValidationFailed, BadRequest, Unauthenticated, Forbidden, NotFound, Conflict, RateLimited, BackendError, BackendUnavailable }

public sealed record FieldError
{
    public string? Name { get; init; }
    public required string Message { get; init; }
}

public sealed record MappedError
{
    public required BackendErrorCode Error { get; init; }
    public required string Message { get; init; }
    public required int Status { get; init; }
    public required bool Retryable { get; init; }
    public IReadOnlyList<FieldError>? Fields { get; init; }
    public int? RetryAfterSeconds { get; init; }
    public string? Reference { get; init; }
}

public sealed record InvokeSuccess
{
    public required int Status { get; init; }
    public JsonNode? Body { get; init; }
    public string? ContentType { get; init; }
    public string? Location { get; init; }
}
