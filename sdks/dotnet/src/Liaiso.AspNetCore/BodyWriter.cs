using System.Security.Cryptography;
using System.Text;

namespace Liaiso.AspNetCore.Requests;

internal sealed record ResolvedFile(ReadOnlyMemory<byte> Bytes, string FileName, string MediaType);

internal sealed record WrittenBody(byte[] Bytes, string ContentType);

/// <summary>Serializes a composed body into the bytes and <c>Content-Type</c> the synthetic request carries.</summary>
/// <remarks>
/// Hand-written rather than <c>MultipartFormDataContent</c> so both SDKs write the same part headers.
/// The twin is <c>writeBody</c> in sdks/nestjs/src/body-writer.ts.
/// </remarks>
internal static class BodyWriter
{
    /// <summary>
    /// Guard: a <c>Content-Disposition</c> quoted-string ends at <c>"</c> and a header ends at CR or
    /// LF, so each is escaped the way the WHATWG form-data encoder escapes them. Field names come
    /// from the backend and filenames from a resolver, neither of which the agent-side gate covers.
    /// </summary>
    private static string Quoted(string value) =>
        value.Replace("\"", "%22", StringComparison.Ordinal)
            .Replace("\r", "%0D", StringComparison.Ordinal)
            .Replace("\n", "%0A", StringComparison.Ordinal);

    private static bool IsPrintableAscii(string value) => value.All(c => c is >= ' ' and <= '~');

    /// <summary>
    /// Guard: multer decodes a bare <c>filename</c> as latin1 and mangles UTF-8 (form-body-probe N3),
    /// while both multer and ASP.NET decode RFC 5987 <c>filename*</c> correctly (N3b,
    /// FormBindingProbeTests.P8). A non-ASCII name travels as an ASCII fallback plus <c>filename*</c>.
    /// </summary>
    private static string DispositionOf(string name, string? fileName)
    {
        string disposition = $"form-data; name=\"{Quoted(name)}\"";
        if (fileName is null)
        {
            return disposition;
        }
        if (IsPrintableAscii(fileName))
        {
            return $"{disposition}; filename=\"{Quoted(fileName)}\"";
        }
        string fallback = new([.. fileName.Select(c => c is >= ' ' and <= '~' ? c : '_')]);
        return $"{disposition}; filename=\"{Quoted(fallback)}\"; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
    }

    private static async ValueTask<ResolvedFile> BytesOf(
        FileContent file, string field, Func<RefFile, string, ValueTask<ResolvedFile>> resolveRef)
    {
        return file switch
        {
            TextFile text => new ResolvedFile(Encoding.UTF8.GetBytes(text.Text), text.FileName, text.MediaType),
            InlineFile inline => new ResolvedFile(Convert.FromBase64String(inline.Base64), inline.FileName, inline.MediaType),
            RefFile reference => await resolveRef(reference, field).ConfigureAwait(false),
            _ => throw new InvalidOperationException($"Unknown file content '{file.GetType().Name}'."),
        };
    }

    /// <remarks>
    /// Refs are resolved in part order, one at a time: the deadline already bounds the whole call,
    /// and resolving in parallel would let one slow ref hold every other resolver's buffer in memory.
    /// </remarks>
    public static async ValueTask<WrittenBody> WriteAsync(
        ComposedBody body, Func<RefFile, string, ValueTask<ResolvedFile>> resolveRef)
    {
        switch (body)
        {
            case JsonBody json:
                return new WrittenBody(json.Utf8, $"{json.ContentType}; charset=utf-8");
            case TextBody text:
                return new WrittenBody(Encoding.UTF8.GetBytes(text.Value), $"{text.ContentType}; charset=utf-8");
            case UrlEncodedBody form:
                return new WrittenBody(Encoding.ASCII.GetBytes(form.Encoded), form.ContentType);
            case BinaryBody binary:
                ResolvedFile binaryFile = await BytesOf(binary.File, "body", resolveRef).ConfigureAwait(false);
                return new WrittenBody(binaryFile.Bytes.ToArray(), binary.ContentType);
            case MultipartBody multipart:
                string boundary = $"----liaiso-{Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant()}";
                using (MemoryStream stream = new())
                {
                    void Write(string value) => stream.Write(Encoding.UTF8.GetBytes(value));
                    foreach (ComposedPart part in multipart.Parts)
                    {
                        Write($"--{boundary}\r\n");
                        switch (part)
                        {
                            case FieldPart field:
                                Write($"Content-Disposition: {DispositionOf(field.Name, null)}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n");
                                Write(field.Value);
                                break;
                            case FilePart filePart:
                                ResolvedFile file = await BytesOf(filePart.File, filePart.Name, resolveRef).ConfigureAwait(false);
                                Write($"Content-Disposition: {DispositionOf(filePart.Name, file.FileName)}\r\nContent-Type: {file.MediaType}\r\n\r\n");
                                stream.Write(file.Bytes.Span);
                                break;
                        }
                        Write("\r\n");
                    }
                    Write($"--{boundary}--\r\n");
                    return new WrittenBody(stream.ToArray(), $"{multipart.ContentType}; boundary={boundary}");
                }
            default:
                throw new InvalidOperationException($"Unknown body '{body.GetType().Name}'.");
        }
    }
}
