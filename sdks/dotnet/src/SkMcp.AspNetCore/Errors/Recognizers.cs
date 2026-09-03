using System.Text.Json;
using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Errors;

internal static class Recognizers
{
    private static readonly string[] EnvelopeKeys =
        ["message", "detail", "error_description", "error", "title", "reason"];

    public static readonly IReadOnlyList<ErrorRecognizer> BuiltIn =
    [
        FieldErrors,
        ProblemDetails,
        NestException,
        MessageEnvelope,
        PlainText,
    ];

    internal static string? MediaType(string? contentType)
    {
        if (contentType is null) return null;
        int semicolon = contentType.IndexOf(';');
        string raw = semicolon >= 0 ? contentType[..semicolon] : contentType;
        return raw.Trim().ToLowerInvariant();
    }

    internal static RecognizedError? FieldErrors(ParsedBody parsed, BackendResponse response)
    {
        if (parsed is not ParsedBody.JsonBody { Value: JsonObject obj }) return null;
        if (obj["errors"] is not JsonObject errors) return null;

        List<FieldError> fields = [];
        foreach ((string name, JsonNode? raw) in errors)
        {
            IEnumerable<JsonNode?> messages = raw is JsonArray array ? array : [raw];
            foreach (JsonNode? message in messages)
            {
                if (AsString(message) is { Length: > 0 } text)
                {
                    fields.Add(new FieldError { Name = name, Message = text });
                }
            }
        }
        return fields.Count == 0 ? null : new RecognizedError(Fields: fields);
    }

    internal static RecognizedError? ProblemDetails(ParsedBody parsed, BackendResponse response)
    {
        if (parsed is not ParsedBody.JsonBody { Value: JsonObject obj }) return null;
        string? detail = AsString(obj["detail"]);
        string? title = AsString(obj["title"]);

        bool isProblemJson = MediaType(response.ContentType) == "application/problem+json";
        bool hasProblemShape = (detail is not null || title is not null)
            && obj["status"]?.GetValueKind() == JsonValueKind.Number;
        if (!isProblemJson && !hasProblemShape) return null;

        string? message = detail ?? title;
        return message is null ? null : new RecognizedError(message);
    }

    internal static RecognizedError? NestException(ParsedBody parsed, BackendResponse response)
    {
        if (parsed is not ParsedBody.JsonBody { Value: JsonObject obj }) return null;
        if (obj["statusCode"]?.GetValueKind() != JsonValueKind.Number) return null;

        JsonNode? message = obj["message"];
        if (AsString(message) is { Length: > 0 } single)
        {
            return new RecognizedError(single);
        }
        if (TryGetStringArray(message, out IReadOnlyList<string> strings))
        {
            if (strings.Count == 0) return null;
            if (response.Status is 400 or 422)
            {
                return new RecognizedError(Fields: [.. strings.Select(text => new FieldError { Message = text })]);
            }
            return new RecognizedError(string.Join("; ", strings));
        }
        return null;
    }

    internal static RecognizedError? MessageEnvelope(ParsedBody parsed, BackendResponse response)
    {
        if (parsed is not ParsedBody.JsonBody json) return null;
        if (AsString(json.Value) is { Length: > 0 } literal)
        {
            return new RecognizedError(literal);
        }
        if (json.Value is not JsonObject obj) return null;

        Dictionary<string, JsonNode?> lowered = new(StringComparer.Ordinal);
        foreach ((string key, JsonNode? value) in obj)
        {
            lowered[key.ToLowerInvariant()] = value;
        }
        foreach (string key in EnvelopeKeys)
        {
            if (lowered.TryGetValue(key, out JsonNode? candidate) && AsString(candidate) is { Length: > 0 } text)
            {
                return new RecognizedError(text);
            }
        }
        return null;
    }

    internal static RecognizedError? PlainText(ParsedBody parsed, BackendResponse response)
    {
        if (parsed is not ParsedBody.TextBody text) return null;
        return text.Text.Length > 0 ? new RecognizedError(text.Text) : null;
    }

    private static string? AsString(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue(out string? text) ? text : null;

    private static bool TryGetStringArray(JsonNode? node, out IReadOnlyList<string> values)
    {
        if (node is JsonArray array)
        {
            List<string> collected = [];
            foreach (JsonNode? item in array)
            {
                if (AsString(item) is not { } text)
                {
                    values = [];
                    return false;
                }
                collected.Add(text);
            }
            values = collected;
            return true;
        }
        values = [];
        return false;
    }
}

internal static class StatusTable
{
    private static readonly HashSet<int> RetryableStatuses = [408, 429, 502, 503, 504];

    public static BackendErrorCode CodeFor(int status, bool hasFields)
    {
        if (status == 401) return BackendErrorCode.Unauthenticated;
        if (status == 403) return BackendErrorCode.Forbidden;
        if (status is 404 or 410) return BackendErrorCode.NotFound;
        if (status is 409 or 412 or 428) return BackendErrorCode.Conflict;
        if (status == 429) return BackendErrorCode.RateLimited;
        if (status is 408 or 502 or 503 or 504) return BackendErrorCode.BackendUnavailable;
        if (status >= 500) return BackendErrorCode.BackendError;
        if (status is 400 or 422 && hasFields) return BackendErrorCode.ValidationFailed;
        return BackendErrorCode.BadRequest;
    }

    public static bool IsRetryable(int status) => RetryableStatuses.Contains(status);

    public static string StandardMessage(BackendErrorCode code, int status, int? retryAfterSeconds, string? reference) => code switch
    {
        BackendErrorCode.ValidationFailed =>
            "The backend rejected one or more arguments. Fix the listed fields and call the operation again.",
        BackendErrorCode.BadRequest =>
            $"The backend rejected the request ({status}) without usable details. Check the arguments against the input schema.",
        BackendErrorCode.Unauthenticated =>
            "The backend did not accept the caller's identity (401). The MCP session's credentials were forwarded unchanged; retrying with the same session will not help.",
        BackendErrorCode.Forbidden =>
            "The caller is authenticated but not permitted to perform this operation (403).",
        BackendErrorCode.NotFound =>
            "No resource matched these arguments (404). The operation exists; check identifier arguments.",
        BackendErrorCode.Conflict =>
            $"The request conflicts with the current state of the resource ({status}). Re-read the resource before retrying.",
        BackendErrorCode.RateLimited => retryAfterSeconds is null
            ? "The backend is rate-limiting this caller (429)."
            : $"The backend is rate-limiting this caller (429). Retry after {retryAfterSeconds} seconds.",
        BackendErrorCode.BackendError => reference is null
            ? $"The backend failed while handling the call ({status}). Details were withheld."
            : $"The backend failed while handling the call ({status}). Details were withheld. Reference: {reference}.",
        BackendErrorCode.BackendUnavailable =>
            $"The backend is temporarily unavailable ({status}). Retry later.",
        _ => throw new ArgumentOutOfRangeException(nameof(code), code, null),
    };
}
