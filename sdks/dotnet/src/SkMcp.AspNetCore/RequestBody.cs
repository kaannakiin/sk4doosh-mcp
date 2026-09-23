using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SkMcp.AspNetCore.Requests;

internal abstract record FileContent;

internal sealed record TextFile(string Text, string FileName, string MediaType) : FileContent;

internal sealed record InlineFile(string Base64, int ByteLength, string FileName, string MediaType) : FileContent;

/// <param name="FileName">What the agent sent; preferred over what the resolver reports.</param>
/// <param name="FallbackFileName">The last rung of the ladder, after the agent and the resolver.</param>
internal sealed record RefFile(
    string Ref, string? FileName, string? MediaType, string FallbackFileName, string FallbackMediaType)
    : FileContent;

internal abstract record ComposedPart(string Name);

internal sealed record FieldPart(string Name, string Value) : ComposedPart(Name);

internal sealed record FilePart(string Name, FileContent File) : ComposedPart(Name);

internal abstract record ComposedBody(string ContentType);

internal sealed record JsonBody(string ContentType, byte[] Utf8) : ComposedBody(ContentType);

internal sealed record TextBody(string ContentType, string Value) : ComposedBody(ContentType);

internal sealed record UrlEncodedBody(string Encoded) : ComposedBody(MediaTypes.UrlEncoded);

internal sealed record MultipartBody(IReadOnlyList<ComposedPart> Parts) : ComposedBody(MediaTypes.Multipart);

/// <param name="MaxInlineFileBytes">Decoded base64 bytes summed over one call; <c>text</c> and <c>ref</c> do not count.</param>
internal sealed record ComposeLimits(int MaxInlineFileBytes);

internal static partial class RequestBodyEncoder
{
    public const int DefaultMaxInlineFileBytes = 1_048_576;

    private static readonly string[] FileArgumentKeys = ["text", "base64", "ref", "name", "mediaType"];

    /// <summary>RFC 4648 §4 exactly.</summary>
    /// <remarks>
    /// Guard: <c>Convert.FromBase64String</c> skips whitespace and <c>Buffer.from</c> accepts almost
    /// anything, so without one strict gate the two SDKs would accept different arguments and
    /// decode different bytes from the same one.
    /// </remarks>
    [GeneratedRegex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")]
    private static partial Regex StrictBase64();

    /// <summary>Guard: the agent's filename reaches <c>IFormFile.FileName</c>, which handlers join onto a directory.</summary>
    [GeneratedRegex("[\"\r\n\0/\\\\]")]
    private static partial Regex UnsafeFileName();

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:\\s*;\\s*[A-Za-z0-9!#$&^_.+-]+=(?:[A-Za-z0-9!#$&^_.+-]+|\"[^\"\r\n\\\\]*\"))*$")]
    internal static partial Regex MediaTypeGrammar();

    internal static bool IsUsableFileName(string? value) =>
        !string.IsNullOrEmpty(value) && !UnsafeFileName().IsMatch(value);

    private static SkMcpArgumentException InvalidFile(string field, string detail) =>
        new(SkMcpArgumentException.InvalidFileArgument, $"File argument '{field}' {detail}");

    private static string DefaultMediaTypeOf(FormField binding, string fallback) =>
        binding.MediaType is { } declared && !declared.Contains('*') && declared != "application/octet-stream"
            ? declared
            : fallback;

    private static int Base64ByteLength(string value)
    {
        int padding = value.EndsWith("==", StringComparison.Ordinal) ? 2 : value.EndsWith('=') ? 1 : 0;
        return (value.Length / 4 * 3) - padding;
    }

    private static string SourceKey(FileSource source) => source switch
    {
        FileSource.Text => "text",
        FileSource.Base64 => "base64",
        _ => "ref",
    };

    /// <summary>Reads one file argument.</summary>
    /// <remarks>
    /// An unoffered source is an unknown key, so the refusal never mentions <c>ref</c> to an agent
    /// whose host bound no resolver. The twin is <c>readFile</c> in packages/http/core/src/request-body.ts.
    /// </remarks>
    private static FileContent ReadFile(
        JsonElement value, string field, FormField binding, IReadOnlySet<FileSource> sources)
    {
        HashSet<string> offeredSources = [.. sources.Select(SourceKey)];
        string[] offered = [.. FileArgumentKeys.Where(key =>
            key is "name" or "mediaType" || offeredSources.Contains(key))];
        string shape = $"must be an object with exactly one of {string.Join(", ", offered.Where(key => key is not "name" and not "mediaType"))}.";
        if (value.ValueKind != JsonValueKind.Object)
        {
            throw InvalidFile(field, shape);
        }
        string[] unknown = [.. value.EnumerateObject()
            .Select(property => property.Name)
            .Where(name => !offered.Contains(name, StringComparer.Ordinal))];
        if (unknown.Length > 0)
        {
            throw InvalidFile(field, $"has unknown key(s): {string.Join(", ", unknown)}. Allowed: {string.Join(", ", offered)}.");
        }
        string[] present = [.. new[] { "text", "base64", "ref" }
            .Where(key => value.TryGetProperty(key, out JsonElement _))];
        if (present.Length != 1)
        {
            throw InvalidFile(field, shape);
        }
        string source = present[0];
        JsonElement content = value.GetProperty(source);
        if (content.ValueKind != JsonValueKind.String)
        {
            throw InvalidFile(field, $"'{source}' must be a string.");
        }
        string text = content.GetString()!;
        string? name = null;
        if (value.TryGetProperty("name", out JsonElement nameElement))
        {
            if (nameElement.ValueKind != JsonValueKind.String || !IsUsableFileName(nameElement.GetString()))
            {
                throw InvalidFile(field, "'name' must be a non-empty filename without quotes, slashes, backslashes or control characters.");
            }
            name = nameElement.GetString();
        }
        string? mediaType = null;
        if (value.TryGetProperty("mediaType", out JsonElement typeElement))
        {
            if (typeElement.ValueKind != JsonValueKind.String || !MediaTypeGrammar().IsMatch(typeElement.GetString()!))
            {
                throw InvalidFile(field, "'mediaType' must be a media type such as text/csv.");
            }
            mediaType = typeElement.GetString();
        }
        switch (source)
        {
            case "text":
                return new TextFile(
                    text, name ?? binding.Name, mediaType ?? DefaultMediaTypeOf(binding, "text/plain; charset=utf-8"));
            case "base64":
                if (!StrictBase64().IsMatch(text))
                {
                    throw InvalidFile(field, "'base64' must be standard base64 (RFC 4648 section 4) with padding and no line breaks.");
                }
                return new InlineFile(
                    text, Base64ByteLength(text), name ?? binding.Name,
                    mediaType ?? DefaultMediaTypeOf(binding, "application/octet-stream"));
            default:
                if (text.Length == 0)
                {
                    throw InvalidFile(field, "'ref' must not be empty.");
                }
                return new RefFile(
                    text, name, mediaType, binding.Name, DefaultMediaTypeOf(binding, "application/octet-stream"));
        }
    }

    private static ParameterKind ScalarKind(FormFieldKind kind) => kind switch
    {
        FormFieldKind.Integer => ParameterKind.Integer,
        FormFieldKind.Number => ParameterKind.Number,
        FormFieldKind.Boolean => ParameterKind.Boolean,
        _ => ParameterKind.String,
    };

    private static ParameterBinding Slot(string name, ParameterKind kind) =>
        new(name, ParameterLocation.Query, kind);

    private static IEnumerable<JsonElement> ItemsOf(JsonElement value, bool isArray, string name)
    {
        if (!isArray)
        {
            return [value];
        }
        if (value.ValueKind != JsonValueKind.Array)
        {
            throw new SkMcpArgumentException(
                SkMcpArgumentException.InvalidType, $"Body argument '{name}' must be an array.");
        }
        return value.EnumerateArray().ToArray();
    }

    /// <summary>Walks the typed fields in declaration order and emits one part per wire key.</summary>
    /// <remarks>
    /// Both encodings share this walk so a type rule cannot hold for one and not the other; they
    /// differ only in how a name is encoded. The twin is <c>emitFields</c> in
    /// packages/http/core/src/request-body.ts.
    /// </remarks>
    private static List<ComposedPart> EmitFields(
        FormBinding form, JsonElement value, IReadOnlySet<FileSource> sources, Func<string, string> encodeName)
    {
        List<ComposedPart> parts = [];
        foreach (FormField field in form.Fields)
        {
            if (!value.TryGetProperty(field.Name, out JsonElement item))
            {
                continue;
            }
            if (item.ValueKind == JsonValueKind.Null)
            {
                throw new SkMcpArgumentException(
                    SkMcpArgumentException.NullNotAllowed,
                    $"Body argument '{field.Name}' cannot be null; omit it instead.");
            }
            switch (field.Kind)
            {
                case FormFieldKind.Object:
                    EmitObject(parts, form, field, item, encodeName);
                    break;
                case FormFieldKind.File:
                    int index = 0;
                    foreach (JsonElement element in ItemsOf(item, field.IsArray, field.Name))
                    {
                        string label = field.IsArray ? $"{field.Name}[{index}]" : field.Name;
                        parts.Add(new FilePart(encodeName(field.Name), ReadFile(element, label, field, sources)));
                        index++;
                    }
                    break;
                default:
                    ParameterBinding slot = Slot(field.Name, ScalarKind(field.Kind));
                    foreach (JsonElement element in ItemsOf(item, field.IsArray, field.Name))
                    {
                        parts.Add(new FieldPart(
                            encodeName(field.Name),
                            RequestComposer.FormatScalar(element, slot, SkMcpArgumentException.InvalidType)));
                    }
                    break;
            }
        }
        return parts;
    }

    private static void EmitObject(
        List<ComposedPart> parts, FormBinding form, FormField field, JsonElement item, Func<string, string> encodeName)
    {
        if (item.ValueKind != JsonValueKind.Object)
        {
            throw new SkMcpArgumentException(
                SkMcpArgumentException.InvalidType, $"Body argument '{field.Name}' must be an object.");
        }
        IReadOnlyList<ObjectMember> members = field.Members!;
        HashSet<string> declared = new(members.Select(member => member.Name), StringComparer.Ordinal);
        string[] unknown = [.. item.EnumerateObject()
            .Select(property => property.Name)
            .Where(name => !declared.Contains(name))
            .Select(name => $"{field.Name}.{name}")];
        if (unknown.Length > 0)
        {
            IEnumerable<string> allowed = members.Select(member => $"{field.Name}.{member.Name}").Order(StringComparer.Ordinal);
            throw new SkMcpArgumentException(
                SkMcpArgumentException.UnknownArgument,
                $"Unknown argument(s): {string.Join(", ", unknown)}. Allowed: {string.Join(", ", allowed)}.");
        }
        foreach (ObjectMember member in members)
        {
            if (!item.TryGetProperty(member.Name, out JsonElement memberValue))
            {
                continue;
            }
            ParameterBinding slot = Slot($"{field.Name}.{member.Name}", member.Kind);
            if (memberValue.ValueKind == JsonValueKind.Null)
            {
                throw new SkMcpArgumentException(
                    SkMcpArgumentException.NullNotAllowed,
                    $"Body argument '{slot.Name}' cannot be null; omit it instead.");
            }
            string key = form.Notation == ObjectNotation.Dot
                ? $"{encodeName(field.Name)}.{encodeName(member.Name)}"
                : $"{encodeName(field.Name)}[{encodeName(member.Name)}]";
            foreach (JsonElement element in ItemsOf(memberValue, member.IsArray, slot.Name))
            {
                parts.Add(new FieldPart(key, RequestComposer.FormatScalar(element, slot, SkMcpArgumentException.InvalidType)));
            }
        }
    }

    private static void AssertInlineBudget(
        IReadOnlyList<ComposedPart> parts, ComposeLimits? limits, IReadOnlySet<FileSource> sources)
    {
        int limit = limits?.MaxInlineFileBytes ?? DefaultMaxInlineFileBytes;
        long total = parts.OfType<FilePart>().Select(part => part.File).OfType<InlineFile>().Sum(file => (long)file.ByteLength);
        if (total > limit)
        {
            string advice = sources.Contains(FileSource.Ref)
                ? "Send the file as a 'ref' instead."
                : "Send a smaller file.";
            throw new SkMcpArgumentException(
                SkMcpArgumentException.FileTooLarge,
                $"The base64 file arguments decode to {total} bytes, over the inline limit of {limit} bytes. {advice}");
        }
    }

    /// <summary>Encodes the body value the composer collected into the template's media type.</summary>
    /// <param name="value">The field-mode object, or the body root argument's value.</param>
    public static ComposedBody? Encode(RequestTemplate template, JsonElement? value, ComposeLimits? limits)
    {
        if (value is not { } element)
        {
            return null;
        }
        string contentType = template.ContentType ?? MediaTypes.Json;
        if (MediaTypes.IsJson(contentType))
        {
            return new JsonBody(contentType, Encoding.UTF8.GetBytes(element.GetRawText()));
        }
        string argument = template.BodyRoot ?? "body";
        if (contentType == MediaTypes.Text)
        {
            if (element.ValueKind != JsonValueKind.String)
            {
                throw new SkMcpArgumentException(
                    SkMcpArgumentException.InvalidType, $"Argument '{argument}' must be of type string.");
            }
            return new TextBody(contentType, element.GetString()!);
        }
        FormBinding form = template.Form!;
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new SkMcpArgumentException(
                SkMcpArgumentException.InvalidType, $"Argument '{argument}' must be an object.");
        }
        if (template.BodyRoot is { } root)
        {
            HashSet<string> declared = new(form.Fields.Select(field => field.Name), StringComparer.Ordinal);
            string[] unknown = [.. element.EnumerateObject()
                .Select(property => property.Name)
                .Where(name => !declared.Contains(name))
                .Select(name => $"{root}.{name}")];
            if (unknown.Length > 0)
            {
                IEnumerable<string> allowed = declared.Select(name => $"{root}.{name}").Order(StringComparer.Ordinal);
                throw new SkMcpArgumentException(
                    SkMcpArgumentException.UnknownArgument,
                    $"Unknown argument(s): {string.Join(", ", unknown)}. Allowed: {string.Join(", ", allowed)}.");
            }
        }
        IReadOnlySet<FileSource> sources = template.FileSources ?? new HashSet<FileSource>();
        if (contentType == MediaTypes.UrlEncoded)
        {
            List<ComposedPart> pairs = EmitFields(form, element, sources, Uri.EscapeDataString);
            return new UrlEncodedBody(string.Join('&', pairs.OfType<FieldPart>()
                .Select(pair => $"{pair.Name}={Uri.EscapeDataString(pair.Value)}")));
        }
        List<ComposedPart> parts = EmitFields(form, element, sources, name => name);
        AssertInlineBudget(parts, limits, sources);
        return new MultipartBody(parts);
    }
}
