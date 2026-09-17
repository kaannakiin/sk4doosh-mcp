using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Requests;

public enum ParameterLocation { Path, Query, Header }

public enum ParameterKind { String, Integer, Number, Boolean }

/// <param name="ArraySeparator">
/// The delimiter that joins array items into one value; <c>null</c> repeats the key
/// instead. Normalised from the descriptor's style/explode pair by
/// <see cref="RequestTemplate.ArraySeparatorFor"/> so the invalid pairings cannot be represented.
/// </param>
/// <param name="Argument">
/// The key the agent sends, when it differs from the wire name. <c>null</c> when they are equal,
/// so two bindings describing the same slot stay equal.
/// </param>
/// <param name="Fill">Non-null means hidden: the agent cannot send this, the value comes from here.</param>
public sealed record ParameterBinding(
    string Name, ParameterLocation Location, ParameterKind Kind, bool IsArray = false,
    string? ArraySeparator = null, string? Argument = null, ArgumentFill? Fill = null);

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

    /// <summary>Agent key to wire field, for renamed body fields.</summary>
    public IReadOnlyDictionary<string, string> BodyAliases { get; }

    /// <summary>Wire field to fill, for hidden body fields.</summary>
    public IReadOnlyDictionary<string, ArgumentFill> BodyFills { get; }

    public ArgumentFill? RootFill { get; }

    /// <summary>
    /// Wire names whose fill has to produce a value. Path parameters are always treated as
    /// required; this set carries the body fields and body root the schema declared required.
    /// </summary>
    public IReadOnlySet<string> RequiredFills { get; }

    private RequestTemplate(
        HttpMethod method, string routeTemplate, IReadOnlyList<ParameterBinding> parameters,
        bool hasBody, IReadOnlySet<string> bodyProperties, bool bodyAllowsAdditionalProperties,
        string? bodyRoot, IReadOnlyDictionary<string, string> bodyAliases,
        IReadOnlyDictionary<string, ArgumentFill> bodyFills, ArgumentFill? rootFill,
        IReadOnlySet<string> requiredFills)
    {
        BodyRoot = bodyRoot;
        Method = method;
        RouteTemplate = routeTemplate;
        Parameters = parameters;
        HasBody = hasBody;
        BodyProperties = bodyProperties;
        BodyAllowsAdditionalProperties = bodyAllowsAdditionalProperties;
        BodyAliases = bodyAliases;
        BodyFills = bodyFills;
        RootFill = rootFill;
        RequiredFills = requiredFills;
    }

    /// <summary>The agent-facing names a caller may send.</summary>
    public IReadOnlySet<string> AllowedArgumentNames()
    {
        HashSet<string> allowed = new(StringComparer.Ordinal);
        foreach (ParameterBinding parameter in Parameters)
        {
            if (parameter.Fill is null)
            {
                allowed.Add(parameter.Argument ?? parameter.Name);
            }
        }
        HashSet<string> aliased = new(BodyAliases.Values, StringComparer.Ordinal);
        foreach (string agentName in BodyAliases.Keys)
        {
            allowed.Add(agentName);
        }
        foreach (string field in BodyProperties)
        {
            if (!BodyFills.ContainsKey(field) && !aliased.Contains(field))
            {
                allowed.Add(field);
            }
        }
        if (BodyRoot is not null && RootFill is null)
        {
            allowed.Add(BodyRoot);
        }
        return allowed;
    }

    /// <summary>Wire names the agent may never send.</summary>
    /// <remarks>
    /// This set beats the free-form body allowance. Without that precedence an open body accepts a
    /// hidden field's wire name and the hide is bypassed; and the wire name of a renamed parameter
    /// is accepted, consumed by no loop, and dropped in silence.
    /// </remarks>
    public IReadOnlySet<string> DeniedArgumentNames()
    {
        HashSet<string> denied = new(StringComparer.Ordinal);
        foreach (ParameterBinding parameter in Parameters)
        {
            if (parameter.Fill is not null || parameter.Argument is not null)
            {
                denied.Add(parameter.Name);
            }
        }
        denied.UnionWith(BodyAliases.Values);
        denied.UnionWith(BodyFills.Keys);
        if (BodyRoot is not null && RootFill is not null)
        {
            denied.Add(BodyRoot);
        }
        return denied;
    }

    internal static JsonElement ToElement(JsonNode? node) =>
        node is null
            ? JsonSerializer.Deserialize<JsonElement>("null")
            : JsonSerializer.Deserialize<JsonElement>(node.ToJsonString());

    internal static bool FitsKind(JsonElement element, ParameterKind kind) => kind switch
    {
        ParameterKind.String => element.ValueKind == JsonValueKind.String,
        ParameterKind.Integer => element.ValueKind == JsonValueKind.Number
            && double.IsInteger(element.GetDouble())
            && Math.Abs(element.GetDouble()) <= 9007199254740991d,
        ParameterKind.Number => element.ValueKind == JsonValueKind.Number,
        ParameterKind.Boolean => element.ValueKind is JsonValueKind.True or JsonValueKind.False,
        _ => false,
    };

    /// <summary>Gates a constant fill at tool-production time.</summary>
    /// <remarks>
    /// A constant the binding cannot carry would otherwise fail every call with an error nobody in
    /// the request path can act on: the agent did not send it and cannot remove it.
    /// </remarks>
    private static void AssertConstantFits(ParameterBinding binding)
    {
        if (binding.Fill is not { Kind: ArgumentFillKind.Constant } fill)
        {
            return;
        }
        JsonElement element = ToElement(fill.Value);
        bool ok = binding.IsArray
            ? element.ValueKind == JsonValueKind.Array
                && element.EnumerateArray().All(item => FitsKind(item, binding.Kind))
            : FitsKind(element, binding.Kind);
        if (!ok)
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.InvalidFillConstant,
                $"The constant filling '{binding.Name}' does not fit a {binding.Kind.ToString().ToLowerInvariant()} {binding.Location.ToString().ToLowerInvariant()} parameter.");
        }
    }

    public static RequestTemplate Create(
        HttpMethod method,
        string routeTemplate,
        IReadOnlyList<ParameterBinding>? parameters = null,
        IReadOnlyCollection<string>? bodyProperties = null,
        bool bodyAllowsAdditionalProperties = false,
        string? bodyRoot = null,
        IReadOnlyDictionary<string, string>? bodyAliases = null,
        IReadOnlyDictionary<string, ArgumentFill>? bodyFills = null,
        ArgumentFill? rootFill = null,
        IReadOnlySet<string>? requiredFills = null)
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
        HashSet<string> agentNames = new(StringComparer.Ordinal);
        foreach (ParameterBinding parameter in parameters)
        {
            AssertConstantFits(parameter);
            if (parameter.Fill is null && !agentNames.Add(parameter.Argument ?? parameter.Name))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.ArgumentCollision,
                    $"Curation produces two arguments named '{parameter.Argument ?? parameter.Name}'.");
            }
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

        foreach (string agentName in (bodyAliases ?? new Dictionary<string, string>()).Keys)
        {
            if (!agentNames.Add(agentName))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.ArgumentCollision,
                    $"Curation produces two arguments named '{agentName}'.");
            }
        }

        return new RequestTemplate(
            method, normalizedRoute, parameters.ToArray(), hasBody, body,
            bodyAllowsAdditionalProperties, bodyRoot,
            bodyAliases ?? new Dictionary<string, string>(StringComparer.Ordinal),
            bodyFills ?? new Dictionary<string, ArgumentFill>(StringComparer.Ordinal),
            rootFill,
            requiredFills ?? new HashSet<string>(StringComparer.Ordinal));
    }

    [GeneratedRegex(@"\{([^}:?*]+)[^}]*\}")]
    private static partial Regex RoutePlaceholder();
}
