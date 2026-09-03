using System.Collections.Concurrent;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using SkMcp.AspNetCore.Discovery;

namespace SkMcp.AspNetCore.Visibility.Probe;

public interface IProbeEvaluator
{
    bool CanProbe(CatalogEntry entry);

    Task<VisibilityDecision> ProbeAsync(CatalogEntry entry, HttpRequest? outerRequest, CancellationToken cancellationToken);
}

public sealed class ProbeEvaluator : IProbeEvaluator
{
    private readonly SkMcpDispatcher _dispatcher;
    private readonly IOptions<SkMcpOptions> _options;
    private readonly ILogger<ProbeEvaluator> _logger;
    private readonly ConcurrentDictionary<string, string> _disabled = new(StringComparer.Ordinal);

    public ProbeEvaluator(
        SkMcpDispatcher dispatcher,
        IOptions<SkMcpOptions> options,
        ILogger<ProbeEvaluator> logger,
        ISkMcpCatalogChangeSource changeSource)
    {
        _dispatcher = dispatcher;
        _options = options;
        _logger = logger;
        ChangeToken.OnChange(changeSource.GetChangeToken, () => _disabled.Clear());
    }

    public bool CanProbe(CatalogEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        if (entry.Endpoint is not RouteEndpoint endpoint || _disabled.ContainsKey(entry.Tool.Name))
        {
            return false;
        }
        bool mvc = endpoint.Metadata.GetMetadata<ControllerActionDescriptor>() is not null;
        bool declarative = endpoint.Metadata.GetMetadata<IAuthorizeData>() is not null;
        bool safe = entry.Descriptor.Method is "GET" or "HEAD";
        return mvc || (declarative && safe);
    }

    public async Task<VisibilityDecision> ProbeAsync(
        CatalogEntry entry, HttpRequest? outerRequest, CancellationToken cancellationToken)
    {
        if (!CanProbe(entry))
        {
            return VisibilityDecision.Unknown;
        }

        RouteEndpoint endpoint = (RouteEndpoint)entry.Endpoint!;
        string path = ProbePath(endpoint.RoutePattern, _options.Value.Visibility.ProbeValues);
        ProbeOutcome outcome = await _dispatcher.ProbeAsync(
            new HttpMethod(entry.Descriptor.Method), path, outerRequest, cancellationToken);

        if (outcome.Status is StatusCodes.Status401Unauthorized or StatusCodes.Status403Forbidden)
        {
            return VisibilityDecision.Deny;
        }
        if (outcome.ShortCircuited && outcome.Status < 400)
        {
            return VisibilityDecision.Allow;
        }

        string reason = outcome.Status == StatusCodes.Status404NotFound
            ? "probe path did not route; declare a value in Visibility.ProbeValues for its route parameters"
            : "response came back without the short-circuit marker, so the handler may have run";
        if (_disabled.TryAdd(entry.Tool.Name, reason))
        {
            _logger.LogWarning(
                "sk-mcp probe disabled for '{Tool}' ({Method} {Path} -> {Status}): {Reason}",
                entry.Tool.Name, entry.Descriptor.Method, path, outcome.Status, reason);
        }
        return VisibilityDecision.Unknown;
    }

    private static string ProbePath(RoutePattern pattern, IReadOnlyDictionary<string, string> overrides)
    {
        StringBuilder path = new();
        foreach (RoutePatternPathSegment segment in pattern.PathSegments)
        {
            path.Append('/');
            foreach (RoutePatternPart part in segment.Parts)
            {
                path.Append(part switch
                {
                    RoutePatternLiteralPart literal => literal.Content,
                    RoutePatternSeparatorPart separator => separator.Content,
                    RoutePatternParameterPart parameter => Uri.EscapeDataString(Placeholder(parameter, overrides)),
                    _ => string.Empty,
                });
            }
        }
        return path.Length == 0 ? "/" : path.ToString();
    }

    private static string Placeholder(RoutePatternParameterPart parameter, IReadOnlyDictionary<string, string> overrides)
    {
        if (overrides.TryGetValue(parameter.Name, out string? declared))
        {
            return declared;
        }
        foreach (RoutePatternParameterPolicyReference policy in parameter.ParameterPolicies)
        {
            string constraint = (policy.Content ?? string.Empty).ToLowerInvariant();
            if (constraint is "int" or "long" or "decimal" or "double" or "float"
                || constraint.StartsWith("min", StringComparison.Ordinal)
                || constraint.StartsWith("range", StringComparison.Ordinal))
            {
                return "1";
            }
            if (constraint == "guid")
            {
                return Guid.Empty.ToString();
            }
            if (constraint == "bool")
            {
                return "true";
            }
            if (constraint == "datetime")
            {
                return "2000-01-01";
            }
            if (constraint == "alpha")
            {
                return "probe";
            }
        }
        return "probe";
    }
}
