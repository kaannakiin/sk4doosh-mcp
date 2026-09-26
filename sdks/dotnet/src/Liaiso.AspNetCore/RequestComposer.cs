using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Liaiso.AspNetCore.Spec;

namespace Liaiso.AspNetCore.Requests;

internal sealed record ComposedRequest(
    string PathAndQuery, IReadOnlyDictionary<string, string> Headers, ComposedBody? Content)
{
    /// <summary>
    /// The body bytes of a body that needs no resolution; a multipart or binary body may name a
    /// <c>ref</c> file and is written by the dispatcher instead.
    /// </summary>
    public byte[]? Body => Content switch
    {
        null => null,
        JsonBody json => json.Utf8,
        TextBody text => Encoding.UTF8.GetBytes(text.Value),
        UrlEncodedBody form => Encoding.ASCII.GetBytes(form.Encoded),
        _ => throw new InvalidOperationException("This body has no bytes until its file is resolved and written."),
    };
}

internal static partial class RequestComposer
{
    /// <summary>Composes an HTTP request from flat agent arguments.</summary>
    /// <param name="deferred">
    /// Resolved values keyed by source name. The composer never invokes a provider: the SDK
    /// resolves every source once per invocation and hands the same map to every composition of
    /// that invocation, so a source that is not constant cannot make validation and dispatch
    /// disagree.
    /// </param>
    /// <param name="limits">The invoke budgets the composer enforces itself.</param>
    public static ComposedRequest Compose(
        RequestTemplate template,
        JsonElement arguments,
        IReadOnlyDictionary<string, JsonElement>? deferred = null,
        ComposeLimits? limits = null)
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
            throw new LiaisoArgumentException(
                LiaisoArgumentException.InvalidType,
                $"Arguments must be a JSON object; received {DescribeKind(arguments.ValueKind)}. Send each argument as a property of that object and call the operation again.");
        }

        RejectUnknown(template, args);
        RejectUnknownMembers(template, args);
        Dictionary<string, JsonElement> wire = Translate(template, args);
        ApplyFills(template, wire, deferred);

        string path = template.RouteTemplate;
        foreach (ParameterBinding p in template.Parameters.Where(x => x.Location == ParameterLocation.Path))
        {
            if (!wire.TryGetValue(p.Name, out JsonElement element) || element.ValueKind == JsonValueKind.Null)
            {
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.MissingPathParameter,
                    $"Missing required path argument '{p.Name}'.");
            }
            string segment = p.ContentType is not null
                ? Uri.EscapeDataString(ContentText(p, element))
                : PathSegment(p, element);
            path = path.Replace("{" + p.Name + "}", segment, StringComparison.Ordinal);
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
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.NullNotAllowed,
                    $"Query argument '{p.Name}' cannot be null; omit it instead.");
            }
            if (p.ContentType is not null)
            {
                AppendEncoded(query, p.Name, Uri.EscapeDataString(ContentText(p, element)));
                continue;
            }
            if (p.Members is not null)
            {
                AppendObject(query, p, element);
                continue;
            }
            Func<string, string> encodeValue = p.AllowReserved ? PercentEncodeAllowingReserved : Uri.EscapeDataString;
            if (p.IsArray)
            {
                if (element.ValueKind != JsonValueKind.Array)
                {
                    throw new LiaisoArgumentException(
                        LiaisoArgumentException.InvalidType,
                        $"Query argument '{p.Name}' must be an array.");
                }
                string? separator = p.ArraySeparator;
                string[] items = [.. element.EnumerateArray().Select(item =>
                {
                    string encoded = encodeValue(FormatScalar(item, p, LiaisoArgumentException.InvalidType));
                    // Guard: allowReserved must not write an element's own delimiter raw, or
                    // ["c,d"] would come back as two elements; every other reserved character stays raw.
                    return p.AllowReserved && separator == ","
                        ? encoded.Replace(",", "%2C", StringComparison.Ordinal)
                        : encoded;
                })];
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
                AppendQuery(query, p.Name, FormatScalar(element, p, LiaisoArgumentException.InvalidType), encodeValue);
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
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.NullNotAllowed,
                    $"Header argument '{p.Name}' cannot be null; omit it instead.");
            }
            string value;
            if (p.ContentType is not null)
            {
                value = ContentText(p, element);
            }
            else if (p.IsArray)
            {
                if (element.ValueKind != JsonValueKind.Array)
                {
                    throw new LiaisoArgumentException(
                        LiaisoArgumentException.InvalidType,
                        $"Header argument '{p.Name}' must be an array.");
                }
                string[] items = [.. element.EnumerateArray()
                    .Select(item => FormatScalar(item, p, LiaisoArgumentException.InvalidType))];
                if (items.Length == 0)
                {
                    continue;
                }
                value = string.Join(p.ArraySeparator ?? ",", items);
            }
            else
            {
                value = FormatScalar(element, p, LiaisoArgumentException.InvalidType);
            }
            if (value.AsSpan().IndexOfAny('\r', '\n', '\0') >= 0)
            {
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.HeaderInjection,
                    $"Header argument '{p.Name}' contains a control character.");
            }
            headers[p.Name] = value;
        }

        List<string> cookies = [];
        foreach (ParameterBinding p in template.Parameters.Where(x => x.Location == ParameterLocation.Cookie))
        {
            if (!wire.TryGetValue(p.Name, out JsonElement element))
            {
                continue;
            }
            if (element.ValueKind == JsonValueKind.Null)
            {
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.NullNotAllowed,
                    $"Cookie argument '{p.Name}' cannot be null; omit it instead.");
            }
            if (p.ContentType is not null)
            {
                cookies.Add($"{p.Name}={Uri.EscapeDataString(ContentText(p, element))}");
                continue;
            }
            if (p.IsArray)
            {
                if (element.ValueKind != JsonValueKind.Array)
                {
                    throw new LiaisoArgumentException(
                        LiaisoArgumentException.InvalidType,
                        $"Cookie argument '{p.Name}' must be an array.");
                }
                string[] items = [.. element.EnumerateArray().Select(item => CookieValue(item, p))];
                if (items.Length == 0)
                {
                    continue;
                }
                cookies.Add($"{p.Name}={string.Join(p.ArraySeparator ?? ",", items)}");
            }
            else
            {
                cookies.Add($"{p.Name}={CookieValue(element, p)}");
            }
        }
        if (cookies.Count > 0)
        {
            headers["cookie"] = string.Join("; ", cookies);
        }

        JsonElement? bodyValue = null;
        if (template.BodyRoot is { } root)
        {
            if (template.RootFill is { } rootFill)
            {
                bodyValue = ResolveFill(
                    rootFill, root, template.RequiredFills.Contains(root), deferred, true);
            }
            else if (wire.TryGetValue(root, out JsonElement rootValue))
            {
                bodyValue = rootValue;
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
            bodyValue = JsonSerializer.Deserialize<JsonElement>(bodyObject.ToJsonString());
        }

        ParameterBinding? querystring = template.Parameters.FirstOrDefault(
            x => x.Location == ParameterLocation.Querystring);
        string queryText = query.ToString();
        if (querystring is not null && wire.TryGetValue(querystring.Name, out JsonElement querystringValue))
        {
            queryText = QuerystringText(querystring, querystringValue);
        }

        string pathAndQuery = queryText.Length > 0 ? $"{path}?{queryText}" : path;
        return new ComposedRequest(
            pathAndQuery, headers, RequestBodyEncoder.Encode(template, bodyValue, limits));
    }

    private static string ContentText(ParameterBinding p, JsonElement value)
    {
        if (p.ContentType == MediaTypes.Text)
        {
            if (value.ValueKind != JsonValueKind.String)
            {
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.InvalidType, $"Argument '{p.Name}' must be of type string.");
            }
            return value.GetString()!;
        }
        return CanonicalJson.Stringify(value);
    }

    /// <summary>
    /// A querystring parameter is the whole query string: JSON is percent-encoded as one value, and
    /// urlencoded content writes one pair per declared member in declaration order, repeating the
    /// key for an array member. The twin is <c>querystringText</c> in
    /// packages/http/core/src/request-composer.ts.
    /// </summary>
    private static string QuerystringText(ParameterBinding p, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Null)
        {
            throw new LiaisoArgumentException(
                LiaisoArgumentException.NullNotAllowed,
                $"Query argument '{p.Name}' cannot be null; omit it instead.");
        }
        if (p.ContentType != MediaTypes.UrlEncoded)
        {
            return Uri.EscapeDataString(ContentText(p, value));
        }
        if (value.ValueKind != JsonValueKind.Object)
        {
            throw new LiaisoArgumentException(
                LiaisoArgumentException.InvalidType, $"Query argument '{p.Name}' must be an object.");
        }
        List<string> pairs = [];
        foreach (ObjectMember member in p.Members ?? [])
        {
            if (!value.TryGetProperty(member.Name, out JsonElement item))
            {
                continue;
            }
            ParameterBinding slot = new($"{p.Name}.{member.Name}", ParameterLocation.Query, member.Kind);
            if (item.ValueKind == JsonValueKind.Null)
            {
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.NullNotAllowed,
                    $"Query argument '{slot.Name}' cannot be null; omit it instead.");
            }
            string key = Uri.EscapeDataString(member.Name);
            if (!member.IsArray)
            {
                pairs.Add($"{key}={Uri.EscapeDataString(FormatScalar(item, slot, LiaisoArgumentException.InvalidType))}");
                continue;
            }
            if (item.ValueKind != JsonValueKind.Array)
            {
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.InvalidType, $"Query argument '{slot.Name}' must be an array.");
            }
            foreach (JsonElement element in item.EnumerateArray())
            {
                pairs.Add($"{key}={Uri.EscapeDataString(FormatScalar(element, slot, LiaisoArgumentException.InvalidType))}");
            }
        }
        return string.Join('&', pairs);
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
            throw new LiaisoArgumentException(
                LiaisoArgumentException.UnknownArgument,
                $"Unknown argument(s): {string.Join(", ", unknown)}. Allowed: {string.Join(", ", allowed)}.");
        }
    }

    /// <summary>Rejects a member the template never declared.</summary>
    /// <remarks>
    /// Guard: such a member would otherwise be dropped in silence, which is the failure
    /// <c>RejectUnknown</c> exists to prevent one level up. It runs in the agent namespace,
    /// before <c>Translate</c>, for the same reason that one does.
    /// </remarks>
    private static void RejectUnknownMembers(
        RequestTemplate template, Dictionary<string, JsonElement> args)
    {
        foreach (ParameterBinding p in template.Parameters)
        {
            if (p.Members is not { } members)
            {
                continue;
            }
            string group = p.Argument ?? p.Name;
            if (!args.TryGetValue(group, out JsonElement value)
                || value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }
            HashSet<string> declared = new(members.Select(m => m.Name), StringComparer.Ordinal);
            string[] unknown = [.. value.EnumerateObject()
                .Select(property => property.Name)
                .Where(name => !declared.Contains(name))
                .Select(name => $"{group}.{name}")];
            if (unknown.Length > 0)
            {
                IEnumerable<string> allowed = members
                    .Select(m => $"{group}.{m.Name}")
                    .Order(StringComparer.Ordinal);
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.UnknownArgument,
                    $"Unknown argument(s): {string.Join(", ", unknown)}. Allowed: {string.Join(", ", allowed)}.");
            }
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
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.DeferredValueMissing,
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
        bool headerClean = p.Location != ParameterLocation.Header
            || !items.Any(item => item.ValueKind == JsonValueKind.String
                && item.GetString()!.AsSpan().IndexOfAny('\r', '\n', '\0') >= 0);
        bool cookieClean = !p.RawCookie
            || items.All(item => item.ValueKind != JsonValueKind.String
                || RequestTemplate.IsCookieOctets(item.GetString()!));
        bool clean = headerClean && cookieClean;
        if (!shapeOk || !scalarsOk || !clean)
        {
            throw new LiaisoArgumentException(
                LiaisoArgumentException.DeferredValueInvalid,
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

    private static void AppendObject(
        StringBuilder query, ParameterBinding p, JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new LiaisoArgumentException(
                LiaisoArgumentException.InvalidType,
                $"Query argument '{p.Name}' must be an object.");
        }
        foreach (ObjectMember member in p.Members!)
        {
            if (!element.TryGetProperty(member.Name, out JsonElement value))
            {
                continue;
            }
            ParameterBinding slot = p with
            {
                Name = $"{p.Name}.{member.Name}",
                Kind = member.Kind,
                IsArray = member.IsArray,
                Members = null,
            };
            if (value.ValueKind == JsonValueKind.Null)
            {
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.NullNotAllowed,
                    $"Query argument '{slot.Name}' cannot be null; omit it instead.");
            }
            string key = MemberKey(p, member);
            if (!member.IsArray)
            {
                AppendMember(query, key, Uri.EscapeDataString(
                    FormatScalar(value, slot, LiaisoArgumentException.InvalidType)));
                continue;
            }
            if (value.ValueKind != JsonValueKind.Array)
            {
                throw new LiaisoArgumentException(
                    LiaisoArgumentException.InvalidType,
                    $"Query argument '{slot.Name}' must be an array.");
            }
            foreach (JsonElement item in value.EnumerateArray())
            {
                AppendMember(query, key, Uri.EscapeDataString(
                    FormatScalar(item, slot, LiaisoArgumentException.InvalidType)));
            }
        }
    }

    /// <summary>
    /// Renders one member's full query key. The parameter name and the member name are each
    /// percent-encoded; the notation's structural character is written RAW, never through
    /// <see cref="Uri.EscapeDataString"/>, for the same reason the array delimiter is
    /// (<see cref="SeparatorFor"/>): both languages' encoders escape <c>[</c> and <c>]</c>, so
    /// encoding it would change what the backend's parser reads. <see cref="AppendEncoded"/>
    /// cannot be reused because it escapes the whole name.
    /// </summary>
    private static string MemberKey(ParameterBinding p, ObjectMember member) =>
        p.Notation == ObjectNotation.Dot
            ? $"{Uri.EscapeDataString(p.Name)}.{Uri.EscapeDataString(member.Name)}"
            : $"{Uri.EscapeDataString(p.Name)}[{Uri.EscapeDataString(member.Name)}]";

    private static void AppendMember(
        StringBuilder query, string encodedKey, string encodedValue)
    {
        if (query.Length > 0)
        {
            query.Append('&');
        }
        query.Append(encodedKey).Append('=').Append(encodedValue);
    }

    private static void AppendQuery(StringBuilder query, string name, string value, Func<string, string> encode) =>
        AppendEncoded(query, name, encode(value));

    [GeneratedRegex("%(3A|2F|3F|40|21|24|27|28|29|2A|2C|3B|5B|5D)")]
    private static partial Regex ReservedEscapes();

    /// <summary>
    /// Guard: <c>allowReserved</c> writes RFC 3986 reserved characters raw, except the ones that
    /// delimit the query itself — <c>&amp;</c>, <c>=</c>, <c>#</c>, <c>+</c> and <c>%</c> stay
    /// encoded, or a value would split into pairs, end the query or be read back as a space. The
    /// twin is <c>percentEncodeAllowingReserved</c> in packages/http/core/src/wire-encoding.ts.
    /// </summary>
    internal static string PercentEncodeAllowingReserved(string value) =>
        ReservedEscapes().Replace(
            Uri.EscapeDataString(value),
            m => ((char)Convert.ToInt32(m.Groups[1].Value, 16)).ToString());

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

    /// <summary>
    /// Renders one path segment. Each array element is encoded on its own and the style's
    /// delimiters are written raw, the rule the query delimiter already follows, so an element
    /// containing <c>,</c> or <c>.</c> stays one element and <c>5/../admin</c> stays one segment.
    /// </summary>
    private static string PathSegment(ParameterBinding p, JsonElement value)
    {
        string key = Uri.EscapeDataString(p.Name);
        if (!p.IsArray)
        {
            string item = Uri.EscapeDataString(FormatScalar(value, p, LiaisoArgumentException.InvalidPathType));
            return p.PathStyle switch
            {
                PathStyle.Label => $".{item}",
                PathStyle.Matrix => $";{key}={item}",
                _ => item,
            };
        }
        if (value.ValueKind != JsonValueKind.Array)
        {
            throw new LiaisoArgumentException(
                LiaisoArgumentException.InvalidPathType,
                $"Path argument '{p.Name}' must be an array.");
        }
        string[] items = [.. value.EnumerateArray()
            .Select(item => Uri.EscapeDataString(FormatScalar(item, p, LiaisoArgumentException.InvalidPathType)))];
        if (items.Length == 0)
        {
            throw new LiaisoArgumentException(
                LiaisoArgumentException.MissingPathParameter,
                $"Missing required path argument '{p.Name}'; an empty array fills no segment.");
        }
        return p.PathStyle switch
        {
            PathStyle.Label => $".{string.Join(p.Explode ? "." : ",", items)}",
            PathStyle.Matrix => p.Explode
                ? string.Concat(items.Select(item => $";{key}={item}"))
                : $";{key}={string.Join(",", items)}",
            _ => string.Join(",", items),
        };
    }

    private static string CookieValue(JsonElement element, ParameterBinding p)
    {
        string formatted = FormatScalar(element, p, LiaisoArgumentException.InvalidType);
        if (!p.RawCookie)
        {
            return Uri.EscapeDataString(formatted);
        }
        if (!RequestTemplate.IsCookieOctets(formatted))
        {
            throw new LiaisoArgumentException(
                LiaisoArgumentException.InvalidCookieValue,
                $"Cookie argument '{p.Name}' contains a character a cookie value cannot carry; space, '\"', ',', ';', '\\' and control characters are not allowed.");
        }
        return formatted;
    }

    /// <summary>Joins the cookies an identity carrier already put on the request with the composed ones.</summary>
    /// <exception cref="LiaisoArgumentException">
    /// <c>cookie_carrier_collision</c> when a composed cookie has the name of a carried one: either
    /// side winning would be a silent resolution — the agent overwriting the caller's credential, or
    /// the agent's value vanishing without an error.
    /// </exception>
    internal static string? MergeCookieHeader(string? carried, string? composed)
    {
        if (composed is null)
        {
            return carried;
        }
        if (string.IsNullOrWhiteSpace(carried))
        {
            return composed;
        }
        HashSet<string> names = new(CookieNames(carried), StringComparer.Ordinal);
        string? clash = CookieNames(composed).FirstOrDefault(names.Contains);
        if (clash is not null)
        {
            throw new LiaisoArgumentException(
                LiaisoArgumentException.CookieCarrierCollision,
                $"Cookie '{clash}' already travels with the caller's identity and cannot also be sent as an argument; omit it.");
        }
        return $"{carried}; {composed}";
    }

    private static IEnumerable<string> CookieNames(string header) =>
        header.Split(';')
            .Select(pair => pair.Trim())
            .Where(pair => pair.Length > 0)
            .Select(pair => pair.Split('=', 2)[0].Trim());

    private static string DescribeKind(JsonValueKind kind) => kind switch
    {
        JsonValueKind.Null => "null",
        JsonValueKind.Array => "an array",
        JsonValueKind.String => "a string",
        JsonValueKind.Number => "a number",
        JsonValueKind.True or JsonValueKind.False => "a boolean",
        _ => "a value that is not an object",
    };

    internal static string FormatScalar(JsonElement element, ParameterBinding parameter, string errorCode)
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
                throw new LiaisoArgumentException(
                    errorCode,
                    $"Argument '{parameter.Name}' must be of type {parameter.Kind.ToString().ToLowerInvariant()}.");
        }
    }
}
