using System.Text.RegularExpressions;

namespace SkMcp.AspNetCore.Requests;

public enum ParameterLocation { Path, Query, Header }

public enum ParameterKind { String, Integer, Number, Boolean }

/// <param name="ArraySeparator">
/// The delimiter that joins array items into one value; <c>null</c> repeats the key
/// instead. Normalised from the descriptor's style/explode pair by
/// <see cref="RequestTemplate.ArraySeparatorFor"/> so the invalid pairings cannot be represented.
/// </param>
public sealed record ParameterBinding(
    string Name, ParameterLocation Location, ParameterKind Kind, bool IsArray = false,
    string? ArraySeparator = null);

public sealed partial class RequestTemplate
{
    private static readonly HashSet<string> ReservedHeaderNames =
        new(StringComparer.OrdinalIgnoreCase) { "Authorization", "Cookie" };

    private static readonly Dictionary<string, string> Delimiters = new(StringComparer.Ordinal)
    {
        ["form"] = ",",
        ["spaceDelimited"] = " ",
        ["pipeDelimited"] = "|",
    };

    /// <summary>Normalises an OpenAPI style/explode pair into a separator.</summary>
    /// <param name="explode">
    /// Defaults the way OpenAPI does: <c>true</c> for <c>form</c>, <c>false</c> for every other style.
    /// </param>
    /// <returns>The delimiter to join array items with, or <c>null</c> to repeat the key.</returns>
    /// <exception cref="SkMcpTemplateException">
    /// <c>unsupported_array_style</c> for a pairing that has no wire form.
    /// </exception>
    public static string? ArraySeparatorFor(string? style, bool? explode, string parameterName)
    {
        string resolved = style ?? "form";
        if (!Delimiters.TryGetValue(resolved, out string? delimiter))
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.UnsupportedArrayStyle,
                $"Parameter '{parameterName}' declares an unknown style '{resolved}'.");
        }
        if (explode ?? resolved == "form")
        {
            if (resolved != "form")
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.UnsupportedArrayStyle,
                    $"Parameter '{parameterName}' declares style '{resolved}' with explode true, which has no wire form; set explode false.");
            }
            return null;
        }
        return delimiter;
    }

    public HttpMethod Method { get; }
    public string RouteTemplate { get; }
    public IReadOnlyList<ParameterBinding> Parameters { get; }
    public bool HasBody { get; }
    public IReadOnlySet<string> BodyProperties { get; }
    public bool BodyAllowsAdditionalProperties { get; }
    public string? BodyRoot { get; }

    private RequestTemplate(
        HttpMethod method, string routeTemplate, IReadOnlyList<ParameterBinding> parameters,
        bool hasBody, IReadOnlySet<string> bodyProperties, bool bodyAllowsAdditionalProperties,
        string? bodyRoot)
    {
        BodyRoot = bodyRoot;
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
        bool bodyAllowsAdditionalProperties = false,
        string? bodyRoot = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(routeTemplate);
        parameters ??= [];
        bool hasBody = bodyProperties is not null || bodyAllowsAdditionalProperties || bodyRoot is not null;

        if (bodyRoot is not null && (bodyProperties is not null || bodyAllowsAdditionalProperties))
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.ConflictingBodyModes,
                "A template cannot declare both a body root argument and body properties.");
        }

        if (hasBody && (method == HttpMethod.Get || method == HttpMethod.Head))
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.BodyNotAllowed,
                $"A {method.Method} request cannot declare a body.");
        }

        HashSet<string> names = new(StringComparer.Ordinal);
        foreach (ParameterBinding parameter in parameters)
        {
            if (!names.Add(parameter.Name))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.DuplicateArgument,
                    $"Duplicate argument name '{parameter.Name}'.");
            }
            if (parameter.Location == ParameterLocation.Header
                && ReservedHeaderNames.Contains(parameter.Name))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.IdentityCarrierArgument,
                    $"Header parameter '{parameter.Name}' collides with an identity carrier; identity is never an argument.");
            }
            if (parameter.Location == ParameterLocation.Path && parameter.IsArray)
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.PathParameterArray,
                    $"Path parameter '{parameter.Name}' cannot be an array.");
            }
            if (parameter.Location == ParameterLocation.Header
                && parameter.IsArray && parameter.ArraySeparator is null)
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.HeaderParameterArray,
                    $"Header parameter '{parameter.Name}' is an array but repeats the key, which a header cannot carry; declare explode false.");
            }
        }

        if (bodyRoot is not null && !names.Add(bodyRoot))
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.ArgumentCollision,
                $"Body root argument '{bodyRoot}' collides with a parameter name; rename the parameter.");
        }

        HashSet<string> body = new(StringComparer.Ordinal);
        if (bodyProperties is not null)
        {
            foreach (string property in bodyProperties)
            {
                if (!names.Add(property))
                {
                    throw new SkMcpTemplateException(
                        SkMcpTemplateException.ArgumentCollision,
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
                    SkMcpTemplateException.RoutePlaceholderMismatch,
                    $"Path parameter '{parameter.Name}' has no '{{{parameter.Name}}}' placeholder in route '{routeTemplate}'.");
            }
        }
        foreach (string placeholder in placeholders)
        {
            if (!parameters.Any(p => p.Location == ParameterLocation.Path && p.Name == placeholder))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.RoutePlaceholderMismatch,
                    $"Route placeholder '{{{placeholder}}}' has no declared path parameter.");
            }
        }

        return new RequestTemplate(
            method, normalizedRoute, parameters.ToArray(), hasBody, body,
            bodyAllowsAdditionalProperties, bodyRoot);
    }

    [GeneratedRegex(@"\{([^}:?*]+)[^}]*\}")]
    private static partial Regex RoutePlaceholder();
}
