using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Requests;

internal sealed record ComposedRequest(
    string PathAndQuery, IReadOnlyDictionary<string, string> Headers, byte[]? Body);

internal static class RequestComposer
{
    /// <summary>Composes an HTTP request from flat agent arguments.</summary>
    /// <param name="deferred">
    /// Resolved values keyed by source name. The composer never invokes a provider: the SDK
    /// resolves every source once per invocation and hands the same map to every composition of
    /// that invocation, so a source that is not constant cannot make validation and dispatch
    /// disagree.
    /// </param>
    public static ComposedRequest Compose(
        RequestTemplate template,
        JsonElement arguments,
        IReadOnlyDictionary<string, JsonElement>? deferred = null)
    {
        Dictionary<string, JsonElement> args = new(StringComparer.Ordinal);
        if (arguments.ValueKind == JsonValueKind.Object)
        {
            foreach (JsonProperty property in arguments.EnumerateObject())
            {
                args[property.Name] = property.Value;
            }
        }
        else if (arguments.ValueKind != JsonValueKind.Undefined)
        {
            throw new SkMcpArgumentException(
                SkMcpArgumentException.InvalidType, "Arguments must be a JSON object.");
        }

        RejectUnknown(template, args);
        Dictionary<string, JsonElement> wire = Translate(template, args);
        ApplyFills(template, wire, deferred);

        string path = template.RouteTemplate;
        foreach (ParameterBinding p in template.Parameters.Where(x => x.Location == ParameterLocation.Path))
        {
            if (!wire.TryGetValue(p.Name, out JsonElement element) || element.ValueKind == JsonValueKind.Null)
            {
                throw new SkMcpArgumentException(
                    SkMcpArgumentException.MissingPathParameter,
                    $"Missing required path argument '{p.Name}'.");
            }
            string value = FormatScalar(element, p, SkMcpArgumentException.InvalidPathType);
            path = path.Replace("{" + p.Name + "}", Uri.EscapeDataString(value), StringComparison.Ordinal);
        }

        StringBuilder query = new();
        foreach (ParameterBinding p in template.Parameters.Where(x => x.Location == ParameterLocation.Query))
        {
            if (!wire.TryGetValue(p.Name, out JsonElement element))
            {
                continue;
            }
            if (element.ValueKind == JsonValueKind.Null)
            {
                throw new SkMcpArgumentException(
                    SkMcpArgumentException.NullNotAllowed,
                    $"Query argument '{p.Name}' cannot be null; omit it instead.");
            }
            if (p.IsArray)
            {
                if (element.ValueKind != JsonValueKind.Array)
                {
                    throw new SkMcpArgumentException(
                        SkMcpArgumentException.InvalidType,
                        $"Query argument '{p.Name}' must be an array.");
                }
                string[] items = [.. element.EnumerateArray()
                    .Select(item => Uri.EscapeDataString(
                        FormatScalar(item, p, SkMcpArgumentException.InvalidType)))];
                if (items.Length == 0)
                {
                    continue;
                }
                if (p.ArraySeparator is null)
                {
                    foreach (string item in items)
                    {
                        AppendEncoded(query, p.Name, item);
                    }
                }
                else
                {
                    AppendEncoded(query, p.Name, string.Join(SeparatorFor(p.ArraySeparator), items));
                }
            }
            else
            {
                AppendQuery(query, p.Name, FormatScalar(element, p, SkMcpArgumentException.InvalidType));
            }
        }

        Dictionary<string, string> headers = new(StringComparer.OrdinalIgnoreCase);
        foreach (ParameterBinding p in template.Parameters.Where(x => x.Location == ParameterLocation.Header))
        {
            if (!wire.TryGetValue(p.Name, out JsonElement element))
            {
                continue;
            }
            if (element.ValueKind == JsonValueKind.Null)
            {
                throw new SkMcpArgumentException(
                    SkMcpArgumentException.NullNotAllowed,
                    $"Header argument '{p.Name}' cannot be null; omit it instead.");
            }
            string value;
            if (p.IsArray)
            {
                if (element.ValueKind != JsonValueKind.Array)
                {
                    throw new SkMcpArgumentException(
                        SkMcpArgumentException.InvalidType,
                        $"Header argument '{p.Name}' must be an array.");
                }
                string[] items = [.. element.EnumerateArray()
                    .Select(item => FormatScalar(item, p, SkMcpArgumentException.InvalidType))];
                if (items.Length == 0)
                {
                    continue;
                }
                value = string.Join(p.ArraySeparator ?? ",", items);
            }
            else
            {
                value = FormatScalar(element, p, SkMcpArgumentException.InvalidType);
            }
            if (value.AsSpan().IndexOfAny('\r', '\n', '\0') >= 0)
            {
                throw new SkMcpArgumentException(
                    SkMcpArgumentException.HeaderInjection,
                    $"Header argument '{p.Name}' contains a control character.");
            }
            headers[p.Name] = value;
        }

        byte[]? body = null;
        if (template.BodyRoot is { } root)
        {
            if (template.RootFill is { } rootFill)
            {
                JsonElement? filled = ResolveFill(
                    rootFill, root, template.RequiredFills.Contains(root), deferred, true);
                if (filled is { } value)
                {
                    body = Encoding.UTF8.GetBytes(value.GetRawText());
                }
            }
            else if (wire.TryGetValue(root, out JsonElement rootValue))
            {
                body = Encoding.UTF8.GetBytes(rootValue.GetRawText());
            }
        }
        else if (template.HasBody)
        {
            JsonObject bodyObject = [];
            foreach ((string name, JsonElement element) in wire)
            {
                bool isParameter = template.Parameters.Any(x => x.Name == name);
                if (!isParameter && (template.BodyProperties.Contains(name) || template.BodyAllowsAdditionalProperties))
                {
                    bodyObject[name] = JsonNode.Parse(element.GetRawText());
                }
            }
            body = Encoding.UTF8.GetBytes(bodyObject.ToJsonString());
        }

        string pathAndQuery = query.Length > 0 ? $"{path}?{query}" : path;
        return new ComposedRequest(pathAndQuery, headers, body);
    }

    /// <summary>
    /// The deny-list beats the free-form allowance, and the message never names a denied argument.
    /// </summary>
    /// <remarks>
    /// Both halves are load-bearing. Without the precedence, an open body accepts a hidden field's
    /// wire name and the hide is bypassed; without the silence, the error distinguishes "no such
    /// argument" from "that argument is not yours to set" and becomes an existence oracle.
    /// </remarks>
    private static void RejectUnknown(RequestTemplate template, Dictionary<string, JsonElement> args)
    {
        IReadOnlySet<string> allowedNames = template.AllowedArgumentNames();
        IReadOnlySet<string> deniedNames = template.DeniedArgumentNames();
        List<string>? unknown = null;
        foreach (string name in args.Keys)
        {
            bool known = !deniedNames.Contains(name)
                && (allowedNames.Contains(name)
                    || (template.HasBody && template.BodyAllowsAdditionalProperties));
            if (!known)
            {
                (unknown ??= []).Add(name);
            }
        }
        if (unknown is not null)
        {
            IEnumerable<string> allowed = allowedNames.Order(StringComparer.Ordinal);
            throw new SkMcpArgumentException(
                SkMcpArgumentException.UnknownArgument,
                $"Unknown argument(s): {string.Join(", ", unknown)}. Allowed: {string.Join(", ", allowed)}.");
        }
    }

    /// <summary>Rewrites agent keys to wire names.</summary>
    /// <remarks>
    /// Its own step on purpose: <c>RejectUnknown</c> runs on the agent namespace and every loop
    /// runs on the wire namespace. Keys the template never declared keep their name, which is
    /// correct: a free-form body's extra keys are undeclared and therefore uncurated.
    /// </remarks>
    private static Dictionary<string, JsonElement> Translate(
        RequestTemplate template, Dictionary<string, JsonElement> args)
    {
        Dictionary<string, string> agentToWire = new(StringComparer.Ordinal);
        foreach (ParameterBinding p in template.Parameters)
        {
            if (p.Argument is { } agentName)
            {
                agentToWire[agentName] = p.Name;
            }
        }
        foreach ((string agentKey, string wireField) in template.BodyAliases)
        {
            agentToWire[agentKey] = wireField;
        }
        Dictionary<string, JsonElement> wire = new(StringComparer.Ordinal);
        foreach ((string key, JsonElement value) in args)
        {
            wire[agentToWire.TryGetValue(key, out string? mapped) ? mapped : key] = value;
        }
        return wire;
    }

    /// <summary>Resolves one fill to the value that will be written, or null to write nothing.</summary>
    /// <remarks>
    /// A <c>null</c> deferred value is not a value on a path, query or header slot:
    /// <c>null_not_allowed</c> tells the agent to omit the argument instead, and here there is no
    /// agent to tell. On a body slot it is written verbatim, because <c>{"x": null}</c> is a
    /// legitimate body.
    /// </remarks>
    private static JsonElement? ResolveFill(
        ArgumentFill fill,
        string wireName,
        bool required,
        IReadOnlyDictionary<string, JsonElement>? deferred,
        bool isBodySlot)
    {
        if (fill.Kind == ArgumentFillKind.Omit)
        {
            return null;
        }
        if (fill.Kind == ArgumentFillKind.Constant)
        {
            return RequestTemplate.ToElement(fill.Value);
        }
        bool present = fill.Source is { } source
            && deferred is not null
            && deferred.TryGetValue(source, out JsonElement _);
        JsonElement value = present ? deferred![fill.Source!] : default;
        bool missing = !present || (value.ValueKind == JsonValueKind.Null && !isBodySlot);
        if (missing)
        {
            if (required)
            {
                throw new SkMcpArgumentException(
                    SkMcpArgumentException.DeferredValueMissing,
                    $"The operation could not be completed because a value it fills itself was unavailable. Retrying with the same arguments will not help. Argument: '{wireName}'.");
            }
            return null;
        }
        return value;
    }

    private static void AssertFilledParameter(JsonElement value, ParameterBinding p)
    {
        IEnumerable<JsonElement> items = p.IsArray
            ? (value.ValueKind == JsonValueKind.Array ? value.EnumerateArray() : [])
            : [value];
        bool shapeOk = !p.IsArray || value.ValueKind == JsonValueKind.Array;
        bool scalarsOk = shapeOk && items.All(item => RequestTemplate.FitsKind(item, p.Kind));
        bool clean = p.Location != ParameterLocation.Header
            || !items.Any(item => item.ValueKind == JsonValueKind.String
                && item.GetString()!.AsSpan().IndexOfAny('\r', '\n', '\0') >= 0);
        if (!shapeOk || !scalarsOk || !clean)
        {
            throw new SkMcpArgumentException(
                SkMcpArgumentException.DeferredValueInvalid,
                $"The operation could not be completed because a value it fills itself was unusable. Retrying with the same arguments will not help. Argument: '{p.Name}'.");
        }
    }

    private static void ApplyFills(
        RequestTemplate template,
        Dictionary<string, JsonElement> wire,
        IReadOnlyDictionary<string, JsonElement>? deferred)
    {
        foreach (ParameterBinding p in template.Parameters)
        {
            if (p.Fill is not { } fill)
            {
                continue;
            }
            bool required = p.Location == ParameterLocation.Path
                || template.RequiredFills.Contains(p.Name);
            if (ResolveFill(fill, p.Name, required, deferred, false) is not { } value)
            {
                continue;
            }
            AssertFilledParameter(value, p);
            wire[p.Name] = value;
        }
        foreach ((string field, ArgumentFill fill) in template.BodyFills)
        {
            if (ResolveFill(fill, field, template.RequiredFills.Contains(field), deferred, true)
                is { } value)
            {
                wire[field] = value;
            }
        }
    }

    private static void AppendQuery(StringBuilder query, string name, string value) =>
        AppendEncoded(query, name, Uri.EscapeDataString(value));

    private static void AppendEncoded(StringBuilder query, string name, string encodedValue)
    {
        if (query.Length > 0)
        {
            query.Append('&');
        }
        query.Append(Uri.EscapeDataString(name)).Append('=').Append(encodedValue);
    }

    /// <summary>
    /// Renders a delimiter for the query string. The caller appends the result raw, never
    /// through <see cref="Uri.EscapeDataString"/>: the two languages' encoders disagree on
    /// <c>,</c> (EscapeDataString escapes it to <c>%2C</c>, encodeURIComponent leaves it), so
    /// encoding the delimiter would make the two SDKs emit different byte strings for the same
    /// input. A literal space is illegal in a URL, hence <c>%20</c>.
    /// </summary>
    private static string SeparatorFor(string delimiter) => delimiter == " " ? "%20" : delimiter;

    private static string FormatScalar(JsonElement element, ParameterBinding parameter, string errorCode)
    {
        switch (parameter.Kind)
        {
            case ParameterKind.String when element.ValueKind == JsonValueKind.String:
                return element.GetString()!;
            case ParameterKind.Integer when element.ValueKind == JsonValueKind.Number
                && element.GetDouble() is double whole
                && double.IsInteger(whole) && Math.Abs(whole) <= 9007199254740991d:
                return ((long)whole).ToString(CultureInfo.InvariantCulture);
            case ParameterKind.Number when element.ValueKind == JsonValueKind.Number:
                return element.GetDouble().ToString(CultureInfo.InvariantCulture);
            case ParameterKind.Boolean when element.ValueKind is JsonValueKind.True or JsonValueKind.False:
                return element.GetRawText();
            default:
                throw new SkMcpArgumentException(
                    errorCode,
                    $"Argument '{parameter.Name}' must be of type {parameter.Kind.ToString().ToLowerInvariant()}.");
        }
    }
}
