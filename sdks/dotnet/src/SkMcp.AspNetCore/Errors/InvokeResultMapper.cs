using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Errors;

public abstract record InvokeOutcome;

public sealed record InvokeSucceeded(InvokeSuccess Success) : InvokeOutcome;

public sealed record InvokeFailed(MappedError Error) : InvokeOutcome;

public interface IInvokeResultMapper
{
    InvokeOutcome Map(BackendResponse response, IReadOnlySet<string> knownFields);
}

internal sealed class InvokeResultMapper(IOptions<SkMcpOptions> options) : IInvokeResultMapper
{
    private const string FieldLeakMessage = "The value was rejected; details were withheld.";

    private static readonly string[] ReferenceHeaderNames =
        ["x-correlation-id", "x-request-id", "request-id", "x-trace-id"];

    private static readonly Regex TraceIdPattern = new("^[A-Za-z0-9:_.-]{1,100}$", RegexOptions.Compiled);
    private static readonly Regex DigitsOnly = new(@"^\d+$", RegexOptions.Compiled);

    public InvokeOutcome Map(BackendResponse response, IReadOnlySet<string> knownFields)
    {
        ParsedBody parsed = ParseBody(response.Body, response.ContentType);
        int status = response.Status;
        string? reference = status >= 500 ? ResolveReference(response, parsed) : null;

        foreach (ErrorRecognizer recognizer in options.Value.Errors.Recognizers)
        {
            RecognizedError? outcome = recognizer(parsed, response);
            if (outcome is not null)
            {
                return new InvokeFailed(FinalizeError(status, outcome, response, knownFields, reference));
            }
        }

        if (status < 400)
        {
            return new InvokeSucceeded(BuildSuccess(response, parsed));
        }
        if (status == 401)
        {
            return new InvokeFailed(FinalizeError(status, null, response, knownFields, null));
        }
        if (status >= 500)
        {
            return new InvokeFailed(FinalizeError(status, null, response, knownFields, reference));
        }

        foreach (ErrorRecognizer recognizer in Recognizers.BuiltIn)
        {
            RecognizedError? outcome = recognizer(parsed, response);
            if (outcome is not null)
            {
                return new InvokeFailed(FinalizeError(status, outcome, response, knownFields, null));
            }
        }

        return new InvokeFailed(FinalizeError(status, null, response, knownFields, null));
    }

    private static ParsedBody ParseBody(string? body, string? contentType)
    {
        string trimmed = (body ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return new ParsedBody.EmptyBody();
        }

        string? type = Recognizers.MediaType(contentType);
        if (type == "text/html" || LooksLikeHtml(trimmed))
        {
            return new ParsedBody.HtmlBody(trimmed);
        }

        if (ShouldAttemptJson(type) && TryParseJson(trimmed, out JsonNode? value))
        {
            return new ParsedBody.JsonBody(value);
        }

        return new ParsedBody.TextBody(trimmed);
    }

    private static bool LooksLikeHtml(string trimmed)
    {
        string lower = trimmed.ToLowerInvariant();
        return lower.StartsWith("<!doctype", StringComparison.Ordinal) || lower.StartsWith("<html", StringComparison.Ordinal);
    }

    private static bool ShouldAttemptJson(string? type)
    {
        if (type is null) return true;
        if (type is "application/json" or "text/json") return true;
        return type.EndsWith("+json", StringComparison.Ordinal);
    }

    private static bool TryParseJson(string text, out JsonNode? value)
    {
        try
        {
            value = JsonNode.Parse(text);
            return true;
        }
        catch (JsonException)
        {
            value = null;
            return false;
        }
    }

    private static InvokeSuccess BuildSuccess(BackendResponse response, ParsedBody parsed)
    {
        InvokeSuccess result = new() { Status = response.Status };
        result = parsed switch
        {
            ParsedBody.JsonBody json => result with { Body = json.Value },
            ParsedBody.TextBody text => result with { Body = JsonValue.Create(text.Text), ContentType = response.ContentType },
            _ => result,
        };
        if (response.Status is >= 300 and < 400)
        {
            string? location = Header(response.Headers, "location");
            if (!string.IsNullOrEmpty(location))
            {
                result = result with { Location = location };
            }
        }
        return result;
    }

    private static MappedError FinalizeError(
        int status, RecognizedError? outcome, BackendResponse response, IReadOnlySet<string> knownFields, string? reference)
    {
        IReadOnlyList<FieldError> fields = outcome?.Fields ?? [];
        bool hasFields = fields.Count > 0;
        BackendErrorCode code = StatusTable.CodeFor(status, hasFields);
        int? retryAfterSeconds = ParseRetryAfter(Header(response.Headers, "retry-after"));

        string? forwardedMessage = outcome?.Message is { } raw ? LeakFilter.Forwardable(raw) : null;
        string message = forwardedMessage ?? StatusTable.StandardMessage(code, status, retryAfterSeconds, reference);

        return new MappedError
        {
            Error = code,
            Message = message,
            Status = status,
            Retryable = StatusTable.IsRetryable(status),
            Fields = hasFields ? [.. fields.Select(f => NormalizeField(f, knownFields))] : null,
            RetryAfterSeconds = retryAfterSeconds,
            Reference = reference,
        };
    }

    private static FieldError NormalizeField(FieldError field, IReadOnlySet<string> knownFields)
    {
        string message = LeakFilter.Forwardable(field.Message) ?? FieldLeakMessage;
        if (field.Name is null)
        {
            string? resolved = FieldNameFromMessage(field.Message, knownFields);
            return resolved is null
                ? new FieldError { Message = message }
                : new FieldError { Name = resolved, Message = message };
        }
        return new FieldError { Name = NormalizeFieldName(field.Name, knownFields), Message = message };
    }

    private static string? FieldNameFromMessage(string message, IReadOnlySet<string> knownFields)
    {
        if (knownFields.Count == 0)
        {
            return null;
        }
        ReadOnlySpan<char> trimmed = message.AsSpan().TrimStart();
        int length = 0;
        while (length < trimmed.Length
            && (char.IsAsciiLetterOrDigit(trimmed[length])
                || trimmed[length] is '_' or '$'))
        {
            length += 1;
        }
        if (length == 0 || !(char.IsAsciiLetter(trimmed[0]) || trimmed[0] is '_' or '$'))
        {
            return null;
        }
        string token = trimmed[..length].ToString();
        return knownFields.FirstOrDefault(
            candidate => string.Equals(candidate, token, StringComparison.OrdinalIgnoreCase));
    }

    private static string NormalizeFieldName(string name, IReadOnlySet<string> knownFields)
    {
        string stripped = name.StartsWith("$.", StringComparison.Ordinal) ? name[2..] : name;
        return knownFields.FirstOrDefault(candidate => string.Equals(candidate, stripped, StringComparison.OrdinalIgnoreCase))
            ?? stripped;
    }

    private static string? ResolveReference(BackendResponse response, ParsedBody parsed) =>
        ReferenceFromHeaders(response.Headers) ?? ReferenceFromProblemDetails(parsed);

    private static string? ReferenceFromHeaders(IReadOnlyDictionary<string, string> headers)
    {
        foreach (string name in ReferenceHeaderNames)
        {
            string? value = Header(headers, name);
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }
        return null;
    }

    private static string? ReferenceFromProblemDetails(ParsedBody parsed)
    {
        if (parsed is not ParsedBody.JsonBody { Value: JsonObject obj }) return null;
        if (obj["traceId"] is not JsonValue value || !value.TryGetValue(out string? traceId)) return null;
        return TraceIdPattern.IsMatch(traceId) ? traceId : null;
    }

    private static int? ParseRetryAfter(string? value)
    {
        if (value is null) return null;
        string trimmed = value.Trim();
        if (!DigitsOnly.IsMatch(trimmed) || !long.TryParse(trimmed, out long seconds))
        {
            return null;
        }
        return (int)Math.Min(seconds, int.MaxValue);
    }

    private static string? Header(IReadOnlyDictionary<string, string> headers, string name)
    {
        foreach ((string key, string value) in headers)
        {
            if (string.Equals(key, name, StringComparison.OrdinalIgnoreCase))
            {
                return value;
            }
        }
        return null;
    }
}
