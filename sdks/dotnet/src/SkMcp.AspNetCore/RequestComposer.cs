using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SkMcp.AspNetCore.Requests;

internal sealed record ComposedRequest(
    string PathAndQuery, IReadOnlyDictionary<string, string> Headers, byte[]? Body);

internal static class RequestComposer
{
    public static ComposedRequest Compose(RequestTemplate template, JsonElement arguments)
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

        string path = template.RouteTemplate;
        foreach (ParameterBinding p in template.Parameters.Where(x => x.Location == ParameterLocation.Path))
        {
            if (!args.TryGetValue(p.Name, out JsonElement element) || element.ValueKind == JsonValueKind.Null)
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
            if (!args.TryGetValue(p.Name, out JsonElement element))
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
            if (!args.TryGetValue(p.Name, out JsonElement element))
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
            if (args.TryGetValue(root, out JsonElement rootValue))
            {
                body = Encoding.UTF8.GetBytes(rootValue.GetRawText());
            }
        }
        else if (template.HasBody)
        {
            JsonObject bodyObject = [];
            foreach ((string name, JsonElement element) in args)
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

    private static void RejectUnknown(RequestTemplate template, Dictionary<string, JsonElement> args)
    {
        List<string>? unknown = null;
        foreach (string name in args.Keys)
        {
            bool known = template.Parameters.Any(p => p.Name == name)
                || template.BodyProperties.Contains(name)
                || string.Equals(name, template.BodyRoot, StringComparison.Ordinal)
                || (template.HasBody && template.BodyAllowsAdditionalProperties);
            if (!known)
            {
                (unknown ??= []).Add(name);
            }
        }
        if (unknown is not null)
        {
            IEnumerable<string> allowed = template.Parameters.Select(p => p.Name)
                .Concat(template.BodyProperties)
                .Concat(template.BodyRoot is null ? [] : new[] { template.BodyRoot })
                .Order(StringComparer.Ordinal);
            throw new SkMcpArgumentException(
                SkMcpArgumentException.UnknownArgument,
                $"Unknown argument(s): {string.Join(", ", unknown)}. Allowed: {string.Join(", ", allowed)}.");
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
