using Liaiso.AspNetCore.Discovery;

namespace Liaiso.AspNetCore.Files;

public enum FileRefusal { NotFound, Forbidden, Unavailable, TooLarge }

/// <param name="Ref">The string the agent sent. It is not a capability: authorize it against <paramref name="Caller"/>.</param>
/// <param name="Field">The multipart field the file travels in.</param>
/// <param name="MaxBytes">The per-file byte limit; answer <see cref="FileRefusal.TooLarge"/> rather than loading more.</param>
public sealed record FileResolveRequest(
    string Ref, string Field, InvokeTarget Target, McpCaller Caller, int MaxBytes);

public abstract record FileResolution
{
    private FileResolution()
    {
    }

    public sealed record Resolved(ReadOnlyMemory<byte> Bytes, string? FileName = null, string? MediaType = null)
        : FileResolution;

    public sealed record Refused(FileRefusal Reason) : FileResolution;
}

/// <summary>
/// Turns a <c>ref</c> file argument into bytes. liaiso names no storage: registering this service
/// is what makes <c>ref</c> appear in a file argument's schema.
/// </summary>
public interface ILiaisoFileResolver
{
    /// <summary>Shown to the agent as the <c>ref</c> key's description, so it knows what a ref is and where to get one.</summary>
    string RefDescription { get; }

    /// <param name="cancellationToken">Cancelled when the invoke deadline expires or the caller cancels.</param>
    ValueTask<FileResolution> ResolveAsync(FileResolveRequest request, CancellationToken cancellationToken);
}
