using System.Text;
using SkMcp.AspNetCore.Files;

namespace DemoApi;

/// <summary>The demo's attachment store, scoped to the caller: a ref names a file, and only its owner may send it.</summary>
/// <remarks>
/// A ref is a string the agent wrote, so the owner check is the only thing between one caller and
/// another caller's files.
/// </remarks>
public sealed class DemoAttachmentResolver : ISkMcpFileResolver
{
    private sealed record Stored(string Owner, string Name, string Type, byte[] Bytes);

    private static readonly Dictionary<string, Stored> Attachments = new(StringComparer.Ordinal)
    {
        ["att-alice-1"] = new("alice", "invoice.csv", "text/csv", Encoding.UTF8.GetBytes("line,amount\n1,120\n2,80\n")),
        ["att-bob-1"] = new("bob", "notes.txt", "text/plain", Encoding.UTF8.GetBytes("bob's notes")),
    };

    public string RefDescription => "An attachment id such as att-alice-1; only its owner can send it.";

    public ValueTask<FileResolution> ResolveAsync(FileResolveRequest request, CancellationToken cancellationToken)
    {
        if (!Attachments.TryGetValue(request.Ref, out Stored? found) || found.Owner != request.Caller.Subject)
        {
            return ValueTask.FromResult<FileResolution>(new FileResolution.Refused(FileRefusal.NotFound));
        }
        return ValueTask.FromResult<FileResolution>(found.Bytes.Length > request.MaxBytes
            ? new FileResolution.Refused(FileRefusal.TooLarge)
            : new FileResolution.Resolved(found.Bytes, found.Name, found.Type));
    }
}
