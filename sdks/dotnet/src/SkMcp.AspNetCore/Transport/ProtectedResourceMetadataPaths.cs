using Microsoft.AspNetCore.Http;
using ModelContextProtocol.Authentication;

namespace SkMcp.AspNetCore.Transport;

public static class ProtectedResourceMetadataPaths
{
    public const string WellKnownPrefix = "/.well-known/oauth-protected-resource";

    public static PathString For(PathString mcpPattern)
    {
        string value = mcpPattern.Value ?? string.Empty;
        return string.IsNullOrEmpty(value) || value == "/"
            ? new PathString(WellKnownPrefix)
            : new PathString(WellKnownPrefix + value);
    }

    public static Uri ChallengeUri(ProtectedResourceMetadata metadata)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        if (string.IsNullOrWhiteSpace(metadata.Resource)
            || !Uri.TryCreate(metadata.Resource, UriKind.Absolute, out Uri? resource))
        {
            throw new InvalidOperationException(
                "ResourceServer.Metadata.Resource must be an absolute URI to derive a challenge URI.");
        }

        string path = resource.AbsolutePath == "/" ? string.Empty : resource.AbsolutePath.TrimEnd('/');
        UriBuilder builder = new(resource)
        {
            Path = WellKnownPrefix + path,
            Query = string.Empty,
            Fragment = string.Empty,
        };
        return builder.Uri;
    }
}
