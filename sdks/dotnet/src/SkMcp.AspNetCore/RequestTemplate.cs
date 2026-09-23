using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Requests;

public enum ParameterLocation { Path, Query, Header }

public enum ParameterKind { String, Integer, Number, Boolean }

public enum ObjectNotation { Bracket, Dot }

/// <param name="Name">
/// The member's wire name; the full query key is the parameter name, the notation's structural
/// character, and this.
/// </param>
public sealed record ObjectMember(string Name, ParameterKind Kind, bool IsArray = false);

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
/// <param name="Members">
/// Non-null means the parameter is object-valued; each member becomes its own query key, written
/// in this order. Frozen at template-build time so the composer never reads a schema and the
/// agent's own key order cannot change the composed string.
/// </param>
public sealed record ParameterBinding(
    string Name, ParameterLocation Location, ParameterKind Kind, bool IsArray = false,
    string? ArraySeparator = null, string? Argument = null, ArgumentFill? Fill = null,
    IReadOnlyList<ObjectMember>? Members = null,
    ObjectNotation Notation = ObjectNotation.Bracket);

public enum FileSource { Text, Base64, Ref }

public enum FormFieldKind { String, Integer, Number, Boolean, Object, File }

/// <param name="Members">Non-null exactly when <paramref name="Kind"/> is <c>Object</c>.</param>
/// <param name="MediaType">
/// The descriptor's <c>contentMediaType</c> for a file field, the last default before
/// <c>application/octet-stream</c>.
/// </param>
public sealed record FormField(
    string Name, FormFieldKind Kind, bool IsArray = false,
    IReadOnlyList<ObjectMember>? Members = null, string? MediaType = null);

/// <summary>The typed fields of a form or multipart body, in the order the composer writes them.</summary>
/// <remarks>In field mode the names are the body's wire fields; with a body root they are the root object's members.</remarks>
public sealed record FormBinding(ObjectNotation Notation, IReadOnlyList<FormField> Fields);

public static partial class MediaTypes
{
    public const string Json = "application/json";
    public const string UrlEncoded = "application/x-www-form-urlencoded";
    public const string Multipart = "multipart/form-data";
    public const string Text = "text/plain";

    [GeneratedRegex(@"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*\+json$")]
    private static partial Regex JsonSuffix();

    /// <summary><c>application/json</c>, <c>text/json</c>, and every <c>+json</c> structured-syntax suffix type.</summary>
    public static bool IsJson(string mediaType) =>
        mediaType == Json || mediaType == "text/json" || JsonSuffix().IsMatch(mediaType);

    public static bool IsForm(string mediaType) => mediaType is UrlEncoded or Multipart;
}

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
        if (resolved == "deepObject")
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.UnsupportedArrayStyle,
                $"Parameter '{parameterName}' is an array and declares style 'deepObject', which addresses object members and has no array form.");
        }
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

    /// <summary><c>null</c> means <c>application/json</c>.</summary>
    public string? ContentType { get; }

    /// <summary>Non-null exactly when <see cref="ContentType"/> is a form or multipart type.</summary>
    public FormBinding? Form { get; }

    /// <summary>Non-null exactly when <see cref="Form"/> declares a file field.</summary>
    public IReadOnlySet<FileSource>? FileSources { get; }

    public static readonly IReadOnlySet<FileSource> DefaultFileSources =
        new HashSet<FileSource> { FileSource.Text, FileSource.Base64 };

    private RequestTemplate(
        HttpMethod method, string routeTemplate, IReadOnlyList<ParameterBinding> parameters,
        bool hasBody, IReadOnlySet<string> bodyProperties, bool bodyAllowsAdditionalProperties,
        string? bodyRoot, IReadOnlyDictionary<string, string> bodyAliases,
        IReadOnlyDictionary<string, ArgumentFill> bodyFills, ArgumentFill? rootFill,
        IReadOnlySet<string> requiredFills, string? contentType, FormBinding? form,
        IReadOnlySet<FileSource>? fileSources)
    {
        ContentType = contentType;
        Form = form;
        FileSources = fileSources;
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

    /// <summary>Normalises a descriptor's style/explode/notation triple for an object parameter.</summary>
    /// <returns>The notation the composer writes between the parameter name and a member name.</returns>
    /// <exception cref="SkMcpTemplateException">
    /// <c>unsupported_object_style</c> for a triple that has no wire form. The twin is
    /// <c>objectBindingFor</c> in packages/core/src/tool.ts.
    /// </exception>
    public static ObjectNotation ObjectNotationFor(
        string? style, bool? explode, string? notation, string parameterName)
    {
        if (style != "deepObject")
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.UnsupportedObjectStyle,
                $"Parameter '{parameterName}' has an object schema but declares style '{style ?? "form"}'; only deepObject has a wire form.");
        }
        if (explode == false)
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.UnsupportedObjectStyle,
                $"Parameter '{parameterName}' declares deepObject with explode false, which OpenAPI leaves undefined; omit explode or set it true.");
        }
        return notation switch
        {
            "dot" => ObjectNotation.Dot,
            null or "bracket" => ObjectNotation.Bracket,
            _ => throw new SkMcpTemplateException(
                SkMcpTemplateException.UnsupportedObjectStyle,
                $"Parameter '{parameterName}' declares an unknown object notation '{notation}'."),
        };
    }

    [GeneratedRegex(@"[\[\].]|^\d+$")]
    private static partial Regex StructuralMemberName();

    /// <summary>Gates an object-valued binding at tool-production time.</summary>
    /// <remarks>
    /// Guard: a member name the notation would re-read as structure is refused rather than
    /// escaped. <c>filter[a.b]</c> and <c>filter.a.b</c> are both ambiguous, and Express's
    /// <c>qs</c> reads <c>filter[0]</c> as array index 0 rather than a member named <c>0</c>, so
    /// such a name does not address the member the host declared. The twin is
    /// <c>assertObjectBinding</c> in packages/core/src/request-template.ts.
    /// </remarks>
    private static void AssertObjectBinding(ParameterBinding binding)
    {
        if (binding.Members is not { } members)
        {
            return;
        }
        if (binding.Location != ParameterLocation.Query || binding.IsArray)
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.UnsupportedObjectStyle,
                $"Parameter '{binding.Name}' is an object, which only a non-array query parameter can be.");
        }
        if (binding.Fill is not null)
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.UnsupportedObjectStyle,
                $"Parameter '{binding.Name}' is an object and cannot be hidden or filled.");
        }
        if (members.Count == 0)
        {
            throw new SkMcpTemplateException(
                SkMcpTemplateException.UnsupportedObjectStyle,
                $"Parameter '{binding.Name}' is an object but declares no members.");
        }
        HashSet<string> seen = new(StringComparer.Ordinal);
        foreach (ObjectMember member in members)
        {
            if (StructuralMemberName().IsMatch(member.Name))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.UnsupportedObjectNesting,
                    $"Member '{binding.Name}.{member.Name}' carries a name the notation reads as structure; rename it.");
            }
            if (!seen.Add(member.Name))
            {
                throw new SkMcpTemplateException(
                    SkMcpTemplateException.UnsupportedObjectStyle,
                    $"Parameter '{binding.Name}' declares two members named '{member.Name}'.");
            }
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
        IReadOnlySet<string>? requiredFills = null,
        string? contentType = null,
        FormBinding? form = null,
        IReadOnlySet<FileSource>? fileSources = null)
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
            AssertObjectBinding(parameter);
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

        AssertBodyEncoding(
            hasBody, contentType, form, bodyRoot, bodyProperties, bodyAllowsAdditionalProperties,
            bodyFills, fileSources);
        string? effective = hasBody && contentType is not null && contentType != MediaTypes.Json
            ? contentType
            : null;
        FormBinding? keptForm = effective is null ? null : form;
        IReadOnlySet<FileSource>? keptSources =
            keptForm?.Fields.Any(field => field.Kind == FormFieldKind.File) == true
                ? fileSources ?? DefaultFileSources
                : null;

        return new RequestTemplate(
            method, normalizedRoute, parameters.ToArray(), hasBody, body,
            bodyAllowsAdditionalProperties, bodyRoot,
            bodyAliases ?? new Dictionary<string, string>(StringComparer.Ordinal),
            bodyFills ?? new Dictionary<string, ArgumentFill>(StringComparer.Ordinal),
            rootFill,
            requiredFills ?? new HashSet<string>(StringComparer.Ordinal),
            effective, keptForm, keptSources);
    }

    private static SkMcpTemplateException BodyShape(string message) =>
        new(SkMcpTemplateException.UnsupportedBodyShape, message);

    /// <summary>Every rejection a non-JSON body can carry that the binding types cannot already express.</summary>
    /// <remarks>
    /// A form body is closed and typed: a free-form one has no field list to encode from, and a
    /// hidden value in a file or object field would need a second type gate for a shape no fill is
    /// declared for. A file in a urlencoded body has no wire form at all. The twin is
    /// <c>assertBodyEncoding</c> in packages/http/core/src/request-template.ts.
    /// </remarks>
    private static void AssertBodyEncoding(
        bool hasBody, string? contentType, FormBinding? form, string? bodyRoot,
        IReadOnlyCollection<string>? bodyProperties, bool bodyAllowsAdditionalProperties,
        IReadOnlyDictionary<string, ArgumentFill>? bodyFills, IReadOnlySet<FileSource>? fileSources)
    {
        string type = contentType ?? MediaTypes.Json;
        if (!hasBody)
        {
            if (form is not null)
            {
                throw BodyShape("A template without a body cannot declare form fields.");
            }
            return;
        }
        if (MediaTypes.IsJson(type))
        {
            if (form is not null)
            {
                throw BodyShape($"A {type} body cannot declare form fields.");
            }
            return;
        }
        if (type == MediaTypes.Text)
        {
            if (bodyRoot is null || form is not null)
            {
                throw BodyShape("A text/plain body is a single string and takes the body root argument.");
            }
            return;
        }
        if (!MediaTypes.IsForm(type))
        {
            throw BodyShape($"No writer exists for a {type} body.");
        }
        if (form is null || form.Fields.Count == 0)
        {
            throw BodyShape($"A {type} body declares no typed fields.");
        }
        if (bodyAllowsAdditionalProperties)
        {
            throw BodyShape($"A {type} body cannot be free-form; declare its fields.");
        }
        HashSet<string> names = new(StringComparer.Ordinal);
        foreach (FormField field in form.Fields)
        {
            if (!names.Add(field.Name))
            {
                throw BodyShape($"The body declares two fields named '{field.Name}'.");
            }
            if (field.Kind == FormFieldKind.Object)
            {
                if (field.Members is not { Count: > 0 } members)
                {
                    throw BodyShape($"Field '{field.Name}' is an object but declares no members.");
                }
                HashSet<string> seen = new(StringComparer.Ordinal);
                foreach (ObjectMember member in members)
                {
                    if (StructuralMemberName().IsMatch(member.Name))
                    {
                        throw BodyShape(
                            $"Member '{field.Name}.{member.Name}' carries a name the notation reads as structure; rename it.");
                    }
                    if (!seen.Add(member.Name))
                    {
                        throw BodyShape($"Field '{field.Name}' declares two members named '{member.Name}'.");
                    }
                }
            }
            if (field.Kind == FormFieldKind.File && type == MediaTypes.UrlEncoded)
            {
                throw BodyShape(
                    $"Field '{field.Name}' is a file, which only a multipart/form-data body can carry.");
            }
            if (field.Kind is FormFieldKind.File or FormFieldKind.Object
                && bodyFills?.ContainsKey(field.Name) == true)
            {
                throw BodyShape(
                    $"Field '{field.Name}' is a {field.Kind.ToString().ToLowerInvariant()} and cannot be hidden or filled.");
            }
        }
        if (bodyRoot is null)
        {
            HashSet<string> declared = new(bodyProperties ?? [], StringComparer.Ordinal);
            if (!declared.SetEquals(names))
            {
                throw BodyShape("The form fields do not name the body's properties.");
            }
        }
        if (form.Fields.Any(field => field.Kind == FormFieldKind.File) && fileSources is { Count: 0 })
        {
            throw BodyShape("A file field needs at least one file source.");
        }
    }

    [GeneratedRegex(@"\{([^}:?*]+)[^}]*\}")]
    private static partial Regex RoutePlaceholder();
}
