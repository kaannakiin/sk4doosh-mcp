using Microsoft.Extensions.Options;

namespace SkMcp.AspNetCore;

internal sealed class SkMcpOptionsValidator : IValidateOptions<SkMcpOptions>
{
    public ValidateOptionsResult Validate(string? name, SkMcpOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        List<string> failures = [];
        if (options.Cache.Lifetime < TimeSpan.Zero)
        {
            failures.Add("Cache.Lifetime must be zero or positive.");
        }
        if (options.Cache.MaxCallers < 1)
        {
            failures.Add("Cache.MaxCallers must be at least 1.");
        }
        if (options.Visibility.ProbeTopK < 0)
        {
            failures.Add("Visibility.ProbeTopK must be zero or positive.");
        }
        if (options.Visibility.ProbeConcurrency < 1)
        {
            failures.Add("Visibility.ProbeConcurrency must be at least 1.");
        }
        if (options.Synthetic.Scheme is not (null or "http" or "https"))
        {
            failures.Add("Synthetic.Scheme must be null, 'http' or 'https'.");
        }
        if (options.ResourceServer.Metadata is { } metadata)
        {
            if (!Uri.TryCreate(metadata.Resource, UriKind.Absolute, out Uri? resource)
                || resource.Scheme is not ("http" or "https"))
            {
                failures.Add("ResourceServer.Metadata.Resource must be an absolute http(s) URI.");
            }
            if (metadata.AuthorizationServers is not { Count: > 0 })
            {
                failures.Add("ResourceServer.Metadata.AuthorizationServers must be non-empty.");
            }
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
