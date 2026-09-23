using Microsoft.Extensions.Options;
using SkMcp.AspNetCore.Discovery;

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
        if (options.Invoke.MaxInlineFileBytes < 0)
        {
            failures.Add("Invoke.MaxInlineFileBytes must be zero or positive.");
        }
        if (options.Invoke.MaxFileBytes < 1)
        {
            failures.Add("Invoke.MaxFileBytes must be at least 1.");
        }
        if (options.Invoke.MaxResponseBytes < 1)
        {
            failures.Add("Invoke.MaxResponseBytes must be at least 1.");
        }
        if (options.Invoke.Timeout < TimeSpan.Zero)
        {
            failures.Add("Invoke.Timeout must be zero or positive.");
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

        // Guard: a blank field is not the catch-all. The catch-all leaves the field null, while an
        // empty Route matches only the empty string and no composed route is empty, so the rule
        // would decide nothing.
        for (int position = 0; position < options.Selection.Rules.Count; position += 1)
        {
            SelectionRule rule = options.Selection.Rules[position];
            if (rule.Route is not null && string.IsNullOrWhiteSpace(rule.Route))
            {
                failures.Add(
                    $"Selection.Rules[{position}].Route must not be blank; leave it null to match every route.");
            }
            if (rule.Method is not null && string.IsNullOrWhiteSpace(rule.Method))
            {
                failures.Add(
                    $"Selection.Rules[{position}].Method must not be blank; leave it null to match every method.");
            }
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
