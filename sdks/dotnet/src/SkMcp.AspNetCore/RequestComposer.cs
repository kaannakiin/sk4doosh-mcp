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
                foreach (JsonElement item in element.EnumerateArray())
                {
                    AppendQuery(query, p.Name, FormatScalar(item, p, SkMcpArgumentException.InvalidType));
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
            string value = FormatScalar(element, p, SkMcpArgumentException.InvalidType);
            if (value.AsSpan().IndexOfAny('\r', '\n', '\0') >= 0)
            {
                throw new SkMcpArgumentException(
                    SkMcpArgumentException.HeaderInjection,
                    $"Header argument '{p.Name}' contains a control character.");
            }
            headers[p.Name] = value;
        }

        byte[]? body = null;
        if (template.HasBody)
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
                .Order(StringComparer.Ordinal);
            throw new SkMcpArgumentException(
                SkMcpArgumentException.UnknownArgument,
                $"Unknown argument(s): {string.Join(", ", unknown)}. Allowed: {string.Join(", ", allowed)}.");
        }
    }

    private static void AppendQuery(StringBuilder query, string name, string value)
    {
        if (query.Length > 0)
        {
            query.Append('&');
        }
        query.Append(Uri.EscapeDataString(name)).Append('=').Append(Uri.EscapeDataString(value));
    }

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
