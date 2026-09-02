using System.Text;
using System.Text.RegularExpressions;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Naming;

public static partial class ToolNameFactory
{
    public const int LongNameThreshold = 64;

    public static string Create(EndpointDescriptor endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        string name = string.IsNullOrWhiteSpace(endpoint.OperationId)
            ? FromRoute(endpoint)
            : SnakeCase(endpoint.OperationId);

        if (!ToolNamePattern().IsMatch(name))
        {
            throw new SkMcpCatalogException(
                SkMcpCatalogException.InvalidName,
                $"Generated tool name '{name}' for {endpoint.Method} {endpoint.Route} does not match the required pattern; define an operationId.");
        }
        return name;
    }

    public static IReadOnlyList<string> CreateAll(IEnumerable<EndpointDescriptor> endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        List<string> names = [];
        Dictionary<string, EndpointDescriptor> claimed = new(StringComparer.Ordinal);
        foreach (EndpointDescriptor endpoint in Deduplicate(endpoints, e => e))
        {
            string name = Create(endpoint);
            if (claimed.TryGetValue(name, out EndpointDescriptor? owner))
            {
                throw new SkMcpCatalogException(
                    SkMcpCatalogException.NameCollision,
                    $"Tool name '{name}' is produced by both {owner.Method} {owner.Route} and {endpoint.Method} {endpoint.Route}; define an operationId on one of them.");
            }
            claimed[name] = endpoint;
            names.Add(name);
        }
        return names;
    }

    public static IReadOnlyList<T> Deduplicate<T>(
        IEnumerable<T> items, Func<T, EndpointDescriptor> selector)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(selector);

        List<T> operations = [];
        Dictionary<(string Container, string OperationId, string Method), int> seen = [];

        foreach (T item in items)
        {
            EndpointDescriptor endpoint = selector(item);
            if (string.IsNullOrWhiteSpace(endpoint.OperationId))
            {
                operations.Add(item);
                continue;
            }

            (string, string, string) key = (
                endpoint.Container ?? string.Empty,
                endpoint.OperationId,
                endpoint.Method.ToUpperInvariant());

            if (!seen.TryGetValue(key, out int index))
            {
                seen[key] = operations.Count;
                operations.Add(item);
                continue;
            }
            if (Shorter(endpoint.Route, selector(operations[index]).Route))
            {
                operations[index] = item;
            }
        }
        return operations;
    }

    private static bool Shorter(string candidate, string current) =>
        candidate.Length != current.Length
            ? candidate.Length < current.Length
            : string.CompareOrdinal(candidate, current) < 0;

    private static string FromRoute(EndpointDescriptor endpoint)
    {
        List<string> parts = [endpoint.Method.ToLowerInvariant()];
        List<string> pathParameters = [];

        foreach (string segment in endpoint.Route.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (segment.StartsWith('{') && segment.EndsWith('}'))
            {
                pathParameters.Add("by_" + SnakeCase(PlaceholderName(segment[1..^1])));
            }
            else
            {
                parts.Add(SnakeCase(segment));
            }
        }

        parts.AddRange(pathParameters);
        return Collapse(string.Join('_', parts));
    }

    private static string PlaceholderName(string placeholder)
    {
        string name = placeholder.TrimStart('*');
        int constraint = name.IndexOfAny([':', '?', '=']);
        return constraint >= 0 ? name[..constraint] : name;
    }

    private static string SnakeCase(string value)
    {
        StringBuilder builder = new(value.Length + 8);
        for (int index = 0; index < value.Length; index++)
        {
            char character = value[index];
            if (char.IsAsciiLetterUpper(character))
            {
                bool afterLowercase = index > 0 && char.IsAsciiLetterLower(value[index - 1]);
                bool acronymEnd = index > 0
                    && char.IsAsciiLetterUpper(value[index - 1])
                    && index + 1 < value.Length
                    && char.IsAsciiLetterLower(value[index + 1]);
                if (builder.Length > 0 && (afterLowercase || acronymEnd))
                {
                    builder.Append('_');
                }
                builder.Append(char.ToLowerInvariant(character));
            }
            else if (char.IsAsciiLetterLower(character) || char.IsAsciiDigit(character))
            {
                builder.Append(character);
            }
            else
            {
                builder.Append('_');
            }
        }
        return Collapse(builder.ToString());
    }

    private static string Collapse(string value)
    {
        StringBuilder builder = new(value.Length);
        foreach (char character in value)
        {
            if (character == '_' && (builder.Length == 0 || builder[^1] == '_'))
            {
                continue;
            }
            builder.Append(character);
        }
        while (builder.Length > 0 && builder[^1] == '_')
        {
            builder.Length -= 1;
        }
        return builder.ToString();
    }

    [GeneratedRegex("^[a-z][a-z0-9_]{0,255}$")]
    private static partial Regex ToolNamePattern();
}
