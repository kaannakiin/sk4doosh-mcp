using System.Text;
using System.Text.RegularExpressions;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Naming;

public enum PrefixMode { Always, OnCollision }

public static partial class ToolNameFactory
{
    public const int LongNameThreshold = 64;
    public const string NameDisambiguated = "name_disambiguated";

    private const string ControllerSuffix = "Controller";

    public static string Create(EndpointDescriptor endpoint, PrefixMode mode = PrefixMode.Always)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        if (endpoint.ToolName is not null)
        {
            return Validate(endpoint.ToolName, endpoint);
        }

        string body = CreateBody(endpoint);
        string name = mode == PrefixMode.Always ? ApplyPrefix(body, DerivePrefix(endpoint)) : body;
        return Validate(name, endpoint);
    }

    public static string CreateBody(EndpointDescriptor endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        return string.IsNullOrWhiteSpace(endpoint.OperationId)
            ? FromRoute(endpoint)
            : SnakeCase(endpoint.OperationId);
    }

    public static string? DerivePrefix(EndpointDescriptor endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        if (endpoint.ContainerPrefix is not null)
        {
            return SnakeCase(endpoint.ContainerPrefix);
        }
        if (string.IsNullOrWhiteSpace(endpoint.Container))
        {
            return null;
        }

        string last = endpoint.Container.Split('.', StringSplitOptions.RemoveEmptyEntries) is { Length: > 0 } segments
            ? segments[^1]
            : string.Empty;
        if (last.Length > ControllerSuffix.Length && last.EndsWith(ControllerSuffix, StringComparison.Ordinal))
        {
            last = last[..^ControllerSuffix.Length];
        }
        string prefix = SnakeCase(last);
        return prefix.Length == 0 ? null : prefix;
    }

    public static string ApplyPrefix(string body, string? prefix)
    {
        ArgumentNullException.ThrowIfNull(body);
        return string.IsNullOrEmpty(prefix) || IsRedundant(prefix, body)
            ? body
            : Collapse($"{prefix}_{body}");
    }

    private static string Validate(string name, EndpointDescriptor endpoint)
    {
        if (!ToolNamePattern().IsMatch(name))
        {
            throw new SkMcpCatalogException(
                SkMcpCatalogException.InvalidName,
                $"Generated tool name '{name}' for {endpoint.Method} {endpoint.Route} does not match the required pattern; define an operationId or a tool name.");
        }
        return name;
    }

    private static string Fold(string token) =>
        token.Length > 3 && token.EndsWith('s') ? token[..^1] : token;

    private static string[] TokensOf(string name) =>
        name.Split('_', StringSplitOptions.RemoveEmptyEntries).Select(Fold).ToArray();

    private static bool IsRedundant(string prefix, string body)
    {
        string[] prefixTokens = TokensOf(prefix);
        string[] bodyTokens = TokensOf(body);
        if (prefixTokens.Length == 0 || prefixTokens.Length > bodyTokens.Length)
        {
            return false;
        }
        for (int start = 0; start + prefixTokens.Length <= bodyTokens.Length; start++)
        {
            bool match = true;
            for (int offset = 0; offset < prefixTokens.Length; offset++)
            {
                if (!string.Equals(bodyTokens[start + offset], prefixTokens[offset], StringComparison.Ordinal))
                {
                    match = false;
                    break;
                }
            }
            if (match)
            {
                return true;
            }
        }
        return false;
    }

    public static IReadOnlyList<string> CreateAll(
        IEnumerable<EndpointDescriptor> endpoints,
        PrefixMode mode = PrefixMode.Always,
        Action<string, string>? onDiagnostic = null)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        List<EndpointDescriptor> operations = [.. Deduplicate(endpoints, e => e)];
        List<string> names = [.. operations.Select(e => Create(e, mode))];

        if (mode == PrefixMode.OnCollision)
        {
            Dictionary<string, List<int>> groups = new(StringComparer.Ordinal);
            for (int index = 0; index < operations.Count; index++)
            {
                if (operations[index].ToolName is not null)
                {
                    continue;
                }
                if (!groups.TryGetValue(names[index], out List<int>? group))
                {
                    groups[names[index]] = [index];
                }
                else
                {
                    group.Add(index);
                }
            }
            foreach ((string body, List<int> group) in groups)
            {
                if (group.Count < 2)
                {
                    continue;
                }
                foreach (int index in group)
                {
                    EndpointDescriptor endpoint = operations[index];
                    string prefixed = ApplyPrefix(body, DerivePrefix(endpoint));
                    if (string.Equals(prefixed, body, StringComparison.Ordinal))
                    {
                        continue;
                    }
                    names[index] = prefixed;
                    onDiagnostic?.Invoke(
                        NameDisambiguated,
                        $"Tool name '{body}' collided; {endpoint.Method} {endpoint.Route} is exposed as '{prefixed}'.");
                }
            }
        }

        Dictionary<string, EndpointDescriptor> claimed = new(StringComparer.Ordinal);
        for (int index = 0; index < operations.Count; index++)
        {
            if (claimed.TryGetValue(names[index], out EndpointDescriptor? owner))
            {
                throw new SkMcpCatalogException(
                    SkMcpCatalogException.NameCollision,
                    $"Tool name '{names[index]}' is produced by both {owner.Method} {owner.Route} and {operations[index].Method} {operations[index].Route}; declare a tool name on one of them.");
            }
            claimed[names[index]] = operations[index];
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
