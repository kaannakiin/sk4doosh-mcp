using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Errors;

public sealed record BackendResponse(
    int Status,
    string? ContentType,
    IReadOnlyDictionary<string, string> Headers,
    string? Body);

public abstract record ParsedBody
{
    public sealed record EmptyBody : ParsedBody;

    public sealed record JsonBody(JsonNode? Value) : ParsedBody;

    public sealed record HtmlBody(string Text) : ParsedBody;

    public sealed record TextBody(string Text) : ParsedBody;
}

public sealed record RecognizedError(string? Message = null, IReadOnlyList<FieldError>? Fields = null);

public delegate RecognizedError? ErrorRecognizer(ParsedBody parsed, BackendResponse response);
