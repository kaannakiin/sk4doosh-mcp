using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Liaiso.AspNetCore.Spec;

namespace Liaiso.AspNetCore.Requests;

public enum ParameterLocation { Path, Query, Header, Cookie, Querystring }

public enum ParameterKind { String, Integer, Number, Boolean }

public enum ObjectNotation { Bracket, Dot }

public enum PathStyle { Label, Matrix }

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
/// <param name="PathStyle"><c>null</c> means simple. Only a path parameter carries this.</param>
/// <param name="Explode">Only a path parameter's <c>label</c>/<c>matrix</c> style reads this.</param>
/// <param name="RawCookie">
/// A cookie parameter declaring style <c>cookie</c>: its value is written without percent-encoding,
/// gated to <see cref="RequestTemplate.IsCookieOctets"/> instead.
/// </param>
/// <param name="AllowReserved">Only a query parameter carries this; writes RFC 3986 reserved characters raw.</param>
/// <param name="ContentType">
/// Non-null means the parameter is serialized as this media type rather than by style: the value is
/// written as JSON or text, or — for a querystring — as urlencoded pairs of <see cref="Members"/>.
/// Mutually exclusive with the object-valued reading of <see cref="Members"/>.
/// </param>
public sealed record ParameterBinding(
    string Name, ParameterLocation Location, ParameterKind Kind, bool IsArray = false,
    string? ArraySeparator = null, string? Argument = null, ArgumentFill? Fill = null,
    IReadOnlyList<ObjectMember>? Members = null,
    ObjectNotation Notation = ObjectNotation.Bracket,
    PathStyle? PathStyle = null, bool Explode = false, bool RawCookie = false,
    bool AllowReserved = false, string? ContentType = null);

/// <summary>The normalised style/explode outcome for one scalar or array parameter.</summary>
public sealed record ScalarSerialization(
    string? ArraySeparator = null, PathStyle? PathStyle = null,
    bool Explode = false, bool RawCookie = false, bool AllowReserved = false);

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

    /// <summary>A media type the body is written as the raw bytes of one file.</summary>
    public static bool IsBinary(string mediaType) => !IsJson(mediaType) && mediaType != Text && !IsForm(mediaType);
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
    /// <exception cref="LiaisoTemplateException">
    /// <c>unsupported_array_style</c> for a pairing that has no wire form, and
    /// <c>unsupported_parameter_style</c> for a style no query parameter carries.
    /// </exception>
    public static string? ArraySeparatorFor(string? style, bool? explode, string parameterName)
    {
        string resolved = style ?? "form";
        if (resolved == "deepObject")
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedArrayStyle,
                $"Parameter '{parameterName}' is an array and declares style 'deepObject', which addresses object members and has no array form.");
        }
        if (!Delimiters.TryGetValue(resolved, out string? delimiter))
        {
            throw UnsupportedStyle(parameterName, resolved, ParameterLocation.Query);
        }
        if (explode ?? resolved == "form")
        {
            if (resolved != "form")
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.UnsupportedArrayStyle,
                    $"Parameter '{parameterName}' declares style '{resolved}' with explode true, which has no wire form; set explode false.");
            }
            return null;
        }
        return delimiter;
    }

    private static readonly Dictionary<ParameterLocation, HashSet<string>> StylesByLocation = new()
    {
        [ParameterLocation.Path] = new HashSet<string>(StringComparer.Ordinal) { "simple", "label", "matrix" },
        [ParameterLocation.Query] = new HashSet<string>(StringComparer.Ordinal)
            { "form", "spaceDelimited", "pipeDelimited", "deepObject" },
        [ParameterLocation.Header] = new HashSet<string>(StringComparer.Ordinal) { "simple", "form" },
        [ParameterLocation.Cookie] = new HashSet<string>(StringComparer.Ordinal) { "form", "cookie" },
        [ParameterLocation.Querystring] = new HashSet<string>(StringComparer.Ordinal),
    };

    private static LiaisoTemplateException UnsupportedStyle(
        string parameterName, string style, ParameterLocation location) =>
        new(LiaisoTemplateException.UnsupportedParameterStyle,
            $"Parameter '{parameterName}' declares style '{style}', which a {location.ToString().ToLowerInvariant()} parameter cannot carry.");

    /// <summary>Normalises a scalar or array parameter's OpenAPI style/explode for its location.</summary>
    /// <exception cref="LiaisoTemplateException">
    /// <c>unsupported_parameter_style</c> for a style the location has no wire form for, and every
    /// error <see cref="ArraySeparatorFor"/> raises.
    /// </exception>
    public static ScalarSerialization SerializationFor(
        ParameterLocation location, string? style, bool? explode, bool isArray, string parameterName,
        bool? allowReserved = null)
    {
        if (style is not null && !StylesByLocation[location].Contains(style))
        {
            throw UnsupportedStyle(parameterName, style, location);
        }
        if (allowReserved == true && location != ParameterLocation.Query)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedParameterStyle,
                $"Parameter '{parameterName}' declares allowReserved, which only a query parameter can carry.");
        }
        switch (location)
        {
            case ParameterLocation.Path:
                return new ScalarSerialization(
                    PathStyle: style switch
                    {
                        "label" => Requests.PathStyle.Label,
                        "matrix" => Requests.PathStyle.Matrix,
                        _ => null,
                    },
                    Explode: explode == true);
            case ParameterLocation.Query:
                return new ScalarSerialization(
                    ArraySeparator: isArray ? ArraySeparatorFor(style, explode, parameterName) : null,
                    AllowReserved: allowReserved == true);
            case ParameterLocation.Querystring:
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.UnsupportedParameterContent,
                    $"Parameter '{parameterName}' is a querystring, which is serialized from content, never by style.");
            case ParameterLocation.Header:
                if (!isArray)
                {
                    return new ScalarSerialization();
                }
                return new ScalarSerialization(
                    ArraySeparator: style == "simple" ? "," : ArraySeparatorFor(style, explode, parameterName));
            case ParameterLocation.Cookie:
                // Guard: an exploded cookie array repeats the cookie name, and a server keeps one
                // of the repeats — which one is not specified — so the other values are lost
                // without an error.
                if (explode == true)
                {
                    throw new LiaisoTemplateException(
                        LiaisoTemplateException.UnsupportedParameterStyle,
                        $"Cookie parameter '{parameterName}' declares explode true, which repeats the cookie name; set explode false.");
                }
                return new ScalarSerialization(
                    ArraySeparator: isArray ? "," : null,
                    RawCookie: style == "cookie");
            default:
                throw new ArgumentOutOfRangeException(nameof(location));
        }
    }

    [GeneratedRegex(@"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")]
    private static partial Regex CookieNamePattern();

    [GeneratedRegex(@"^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$")]
    private static partial Regex CookieOctetPattern();

    /// <summary>RFC 6265 <c>cookie-octet</c>: printable US-ASCII without space, <c>"</c>, <c>,</c>, <c>;</c> and <c>\</c>.</summary>
    public static bool IsCookieOctets(string value) => CookieOctetPattern().IsMatch(value);

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
        IEnumerable<JsonElement> items = element.ValueKind == JsonValueKind.Array
            ? element.EnumerateArray()
            : [element];
        bool cookieSafe = !binding.RawCookie
            || items.All(item => item.ValueKind != JsonValueKind.String || IsCookieOctets(item.GetString()!));
        if (!ok || !cookieSafe)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.InvalidFillConstant,
                $"The constant filling '{binding.Name}' does not fit a {binding.Kind.ToString().ToLowerInvariant()} {binding.Location.ToString().ToLowerInvariant()} parameter.");
        }
    }

    /// <summary>Normalises a descriptor's style/explode/notation triple for an object parameter.</summary>
    /// <returns>The notation the composer writes between the parameter name and a member name.</returns>
    /// <exception cref="LiaisoTemplateException">
    /// <c>unsupported_object_style</c> for a triple that has no wire form. The twin is
    /// <c>objectBindingFor</c> in packages/core/src/tool.ts.
    /// </exception>
    public static ObjectNotation ObjectNotationFor(
        string? style, bool? explode, string? notation, string parameterName)
    {
        if (style != "deepObject")
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedObjectStyle,
                $"Parameter '{parameterName}' has an object schema but declares style '{style ?? "form"}'; only deepObject has a wire form.");
        }
        if (explode == false)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedObjectStyle,
                $"Parameter '{parameterName}' declares deepObject with explode false, which OpenAPI leaves undefined; omit explode or set it true.");
        }
        return notation switch
        {
            "dot" => ObjectNotation.Dot,
            null or "bracket" => ObjectNotation.Bracket,
            _ => throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedObjectStyle,
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
        if (binding.ContentType is not null || binding.Members is not { } members)
        {
            return;
        }
        if (binding.Location != ParameterLocation.Query || binding.IsArray)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedObjectStyle,
                $"Parameter '{binding.Name}' is an object, which only a non-array query parameter can be.");
        }
        if (binding.Fill is not null)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedObjectStyle,
                $"Parameter '{binding.Name}' is an object and cannot be hidden or filled.");
        }
        if (members.Count == 0)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedObjectStyle,
                $"Parameter '{binding.Name}' is an object but declares no members.");
        }
        HashSet<string> seen = new(StringComparer.Ordinal);
        foreach (ObjectMember member in members)
        {
            if (StructuralMemberName().IsMatch(member.Name))
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.UnsupportedObjectNesting,
                    $"Member '{binding.Name}.{member.Name}' carries a name the notation reads as structure; rename it.");
            }
            if (!seen.Add(member.Name))
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.UnsupportedObjectStyle,
                    $"Parameter '{binding.Name}' declares two members named '{member.Name}'.");
            }
        }
    }

    /// <summary>Gates a parameter against the slots the endpoint's identity carriers occupy.</summary>
    /// <remarks>
    /// Guard: identity is never an argument. A data parameter in a slot an identity carrier uses
    /// would let the agent write the caller's credential, or collide with it on the wire. Header
    /// names compare case-insensitively, as HTTP defines them; query and cookie names are
    /// case-sensitive.
    /// </remarks>
    private static void AssertNoCarrierSlot(
        IReadOnlyList<ParameterBinding> parameters, IReadOnlyList<IdentityCarrier> carriers)
    {
        foreach (ParameterBinding parameter in parameters)
        {
            string location = parameter.Location.ToString().ToLowerInvariant();
            bool occupied = carriers.Any(carrier =>
                carrier.In == location
                && (location == "header"
                    ? string.Equals(carrier.Name, parameter.Name, StringComparison.OrdinalIgnoreCase)
                    : carrier.Name == parameter.Name));
            if (occupied)
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.IdentityCarrierParameter,
                    $"{location} parameter '{parameter.Name}' occupies the slot an identity carrier uses; identity is never an argument.");
            }
        }
    }

    /// <summary>Gates a content-serialized binding at tool-production time.</summary>
    /// <remarks>The twin is <c>assertContentBinding</c> in packages/http/core/src/request-template.ts.</remarks>
    private static void AssertContentBinding(ParameterBinding binding)
    {
        if (binding.ContentType is not { } contentType)
        {
            return;
        }
        if (contentType == MediaTypes.UrlEncoded && binding.Location != ParameterLocation.Querystring)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedParameterContent,
                $"Parameter '{binding.Name}' is urlencoded content, which only a querystring can carry.");
        }
        if (binding.Location == ParameterLocation.Querystring && contentType == MediaTypes.Text)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedParameterContent,
                $"Querystring '{binding.Name}' is text/plain, which has no query-string form; use JSON or urlencoded content.");
        }
        bool urlencoded = contentType == MediaTypes.UrlEncoded;
        if (binding.Location == ParameterLocation.Header && ReservedHeaderNames.Contains(binding.Name))
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.IdentityCarrierArgument,
                $"Header parameter '{binding.Name}' collides with an identity carrier; identity is never an argument.");
        }
        if (binding.Location == ParameterLocation.Cookie && !CookieNamePattern().IsMatch(binding.Name))
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.InvalidCookieName,
                $"Cookie parameter '{binding.Name}' is not an RFC 6265 cookie name.");
        }
        if (urlencoded && (binding.Members?.Count ?? 0) == 0)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.UnsupportedParameterContent,
                $"Querystring '{binding.Name}' is urlencoded but declares no members to write.");
        }
        foreach (ObjectMember member in binding.Members ?? [])
        {
            if (StructuralMemberName().IsMatch(member.Name))
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.UnsupportedObjectNesting,
                    $"Member '{binding.Name}.{member.Name}' carries a name the query string reads as structure; rename it.");
            }
        }
    }

    /// <summary>Gates the endpoint's querystring parameter against every other parameter.</summary>
    /// <remarks>
    /// Guard: a querystring parameter is the whole query string, so a second one or any query
    /// parameter beside it would have to be merged into it by a rule OpenAPI does not define. The
    /// twin is <c>assertQuerystring</c> in packages/http/core/src/request-template.ts.
    /// </remarks>
    private static void AssertQuerystring(IReadOnlyList<ParameterBinding> parameters)
    {
        int querystrings = parameters.Count(p => p.Location == ParameterLocation.Querystring);
        if (querystrings > 1)
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.MultipleQuerystring,
                "An operation declares more than one querystring parameter.");
        }
        if (querystrings == 1 && parameters.Any(p => p.Location == ParameterLocation.Query))
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.QuerystringWithQuery,
                "An operation declares a querystring parameter beside query parameters.");
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
        IReadOnlySet<FileSource>? fileSources = null,
        IReadOnlyList<IdentityCarrier>? carriers = null,
        bool binaryBody = false)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(routeTemplate);
        parameters ??= [];
        bool hasBody = bodyProperties is not null || bodyAllowsAdditionalProperties || bodyRoot is not null;

        if (bodyRoot is not null && (bodyProperties is not null || bodyAllowsAdditionalProperties))
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.ConflictingBodyModes,
                "A template cannot declare both a body root argument and body properties.");
        }

        if (hasBody && (method == HttpMethod.Get || method == HttpMethod.Head))
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.BodyNotAllowed,
                $"A {method.Method} request cannot declare a body.");
        }

        HashSet<string> names = new(StringComparer.Ordinal);
        HashSet<string> agentNames = new(StringComparer.Ordinal);
        foreach (ParameterBinding parameter in parameters)
        {
            AssertObjectBinding(parameter);
            AssertContentBinding(parameter);
            if (parameter.ContentType is null)
            {
                AssertConstantFits(parameter);
            }
            if (parameter.Fill is null && !agentNames.Add(parameter.Argument ?? parameter.Name))
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.ArgumentCollision,
                    $"Curation produces two arguments named '{parameter.Argument ?? parameter.Name}'.");
            }
            if (!names.Add(parameter.Name))
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.DuplicateArgument,
                    $"Duplicate argument name '{parameter.Name}'.");
            }
            if (parameter.ContentType is not null)
            {
                continue;
            }
            if (parameter.Location == ParameterLocation.Header
                && ReservedHeaderNames.Contains(parameter.Name))
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.IdentityCarrierArgument,
                    $"Header parameter '{parameter.Name}' collides with an identity carrier; identity is never an argument.");
            }
            if (parameter.Location == ParameterLocation.Cookie
                && !CookieNamePattern().IsMatch(parameter.Name))
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.InvalidCookieName,
                    $"Cookie parameter '{parameter.Name}' is not an RFC 6265 cookie name.");
            }
            // A repeated header is unrepresentable: ComposedRequest.Headers is a
            // Dictionary<string, string>, so the second write would overwrite the first. Folding
            // into one comma-separated value (RFC 9110 §5.3) is the only shape that survives, and
            // it has to be asked for explicitly.
            if (parameter.Location == ParameterLocation.Header
                && parameter.IsArray && parameter.ArraySeparator is null)
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.HeaderParameterArray,
                    $"Header parameter '{parameter.Name}' is an array but repeats the key, which a header cannot carry; declare explode false.");
            }
        }

        AssertNoCarrierSlot(parameters, carriers ?? []);
        AssertQuerystring(parameters);

        if (bodyRoot is not null && !names.Add(bodyRoot))
        {
            throw new LiaisoTemplateException(
                LiaisoTemplateException.ArgumentCollision,
                $"Body root argument '{bodyRoot}' collides with a parameter name; rename the parameter.");
        }

        HashSet<string> body = new(StringComparer.Ordinal);
        if (bodyProperties is not null)
        {
            foreach (string property in bodyProperties)
            {
                if (!names.Add(property))
                {
                    throw new LiaisoTemplateException(
                        LiaisoTemplateException.ArgumentCollision,
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
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.RoutePlaceholderMismatch,
                    $"Path parameter '{parameter.Name}' has no '{{{parameter.Name}}}' placeholder in route '{routeTemplate}'.");
            }
        }
        foreach (string placeholder in placeholders)
        {
            if (!parameters.Any(p => p.Location == ParameterLocation.Path && p.Name == placeholder))
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.RoutePlaceholderMismatch,
                    $"Route placeholder '{{{placeholder}}}' has no declared path parameter.");
            }
        }

        foreach (string agentName in (bodyAliases ?? new Dictionary<string, string>()).Keys)
        {
            if (!agentNames.Add(agentName))
            {
                throw new LiaisoTemplateException(
                    LiaisoTemplateException.ArgumentCollision,
                    $"Curation produces two arguments named '{agentName}'.");
            }
        }

        AssertBodyEncoding(
            hasBody, contentType, form, bodyRoot, bodyProperties, bodyAllowsAdditionalProperties,
            bodyFills, fileSources, binaryBody);
        string? effective = hasBody && contentType is not null && contentType != MediaTypes.Json
            ? contentType
            : null;
        FormBinding? keptForm = effective is null ? null : form;
        IReadOnlySet<FileSource>? keptSources =
            keptForm?.Fields.Any(field => field.Kind == FormFieldKind.File) == true
                || (effective is not null && MediaTypes.IsBinary(effective))
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

    private static LiaisoTemplateException BodyShape(string message) =>
        new(LiaisoTemplateException.UnsupportedBodyShape, message);

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
        IReadOnlyDictionary<string, ArgumentFill>? bodyFills, IReadOnlySet<FileSource>? fileSources,
        bool binaryBody)
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
        if (MediaTypes.IsBinary(type))
        {
            if (!binaryBody || bodyRoot is null || form is not null)
            {
                throw BodyShape(
                    $"A {type} body is written as one file's bytes and takes a file as the body root argument.");
            }
            if (fileSources is { Count: 0 })
            {
                throw BodyShape("A file body needs at least one file source.");
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
