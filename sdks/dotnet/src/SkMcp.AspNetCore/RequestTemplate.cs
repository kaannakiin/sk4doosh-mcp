using System.Text.RegularExpressions;

namespace SkMcp.AspNetCore;

public enum ParameterLocation { Path, Query, Header }

public enum ParameterKind { String, Integer, Number, Boolean }

public sealed record ParameterBinding(
    string Name, ParameterLocation Location, ParameterKind Kind, bool IsArray = false);

public sealed partial class RequestTemplate
{
    private static readonly HashSet<string> ReservedHeaderNames =
        new(StringComparer.OrdinalIgnoreCase) { "Authorization", "Cookie" };

    public HttpMethod Method { get; }
    public string RouteTemplate { get; }
    public IReadOnlyList<ParameterBinding> Parameters { get; }
    public bool HasBody { get; }
    public IReadOnlySet<string> BodyProperties { get; }
    public bool BodyAllowsAdditionalProperties { get; }

    private RequestTemplate(
        HttpMethod method, string routeTemplate, IReadOnlyList<ParameterBinding> parameters,
        bool hasBody, IReadOnlySet<string> bodyProperties, bool bodyAllowsAdditionalProperties)
    {
        Method = method;
        RouteTemplate = routeTemplate;
        Parameters = parameters;
        HasBody = hasBody;
        BodyProperties = bodyProperties;
        BodyAllowsAdditionalProperties = bodyAllowsAdditionalProperties;
    }

    public static RequestTemplate Create(
        HttpMethod method,
        string routeTemplate,
        IReadOnlyList<ParameterBinding>? parameters = null,
        IReadOnlyCollection<string>? bodyProperties = null,
        bool bodyAllowsAdditionalProperties = false)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(routeTemplate);
        parameters ??= [];
        bool hasBody = bodyProperties is not null || bodyAllowsAdditionalProperties;

        if (hasBody && (method == HttpMethod.Get || method == HttpMethod.Head))
        {
            throw new SkMcpTemplateException($"A {method.Method} request cannot declare a body.");
        }

        HashSet<string> names = new(StringComparer.Ordinal);
        foreach (ParameterBinding parameter in parameters)
        {
            if (!names.Add(parameter.Name))
            {
                throw new SkMcpTemplateException($"Duplicate argument name '{parameter.Name}'.");
            }
            if (parameter.Location == ParameterLocation.Header
                && ReservedHeaderNames.Contains(parameter.Name))
            {
                throw new SkMcpTemplateException(
                    $"Header parameter '{parameter.Name}' collides with an identity carrier; identity is never an argument.");
            }
            if (parameter.Location == ParameterLocation.Path && parameter.IsArray)
            {
                throw new SkMcpTemplateException($"Path parameter '{parameter.Name}' cannot be an array.");
            }
        }

        HashSet<string> body = new(StringComparer.Ordinal);
        if (bodyProperties is not null)
        {
            foreach (string property in bodyProperties)
            {
                if (!names.Add(property))
                {
                    throw new SkMcpTemplateException(
                        $"Body property '{property}' collides with a parameter name; rename one of them.");
                }
                body.Add(property);
            }
        }

        string normalizedRoute = RoutePlaceholder().Replace(routeTemplate, m => "{" + m.Groups[1].Value + "}");
        HashSet<string> placeholders = RoutePlaceholder().Matches(routeTemplate)
            .Select(m => m.Groups[1].Value)
            .ToHashSet(StringComparer.Ordinal);
        foreach (ParameterBinding parameter in parameters)
        {
            if (parameter.Location == ParameterLocation.Path && !placeholders.Contains(parameter.Name))
            {
                throw new SkMcpTemplateException(
                    $"Path parameter '{parameter.Name}' has no '{{{parameter.Name}}}' placeholder in route '{routeTemplate}'.");
            }
        }
        foreach (string placeholder in placeholders)
        {
            if (!parameters.Any(p => p.Location == ParameterLocation.Path && p.Name == placeholder))
            {
                throw new SkMcpTemplateException(
                    $"Route placeholder '{{{placeholder}}}' has no declared path parameter.");
            }
        }

        return new RequestTemplate(
            method, normalizedRoute, parameters.ToArray(), hasBody, body, bodyAllowsAdditionalProperties);
    }

    [GeneratedRegex(@"\{([^}:?*]+)[^}]*\}")]
    private static partial Regex RoutePlaceholder();
}
