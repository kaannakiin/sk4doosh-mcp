using System.Collections.Concurrent;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkMcp.AspNetCore.Discovery;

namespace SkMcp.AspNetCore.Visibility.Probe;

public interface IProbeEvaluator
{
    bool CanProbe(CatalogEntry entry);

    Task<VisibilityDecision> ProbeAsync(CatalogEntry entry, HttpRequest? outerRequest, CancellationToken cancellationToken);
}

public sealed class ProbeEvaluator(
    SkMcpDispatcher dispatcher,
    IOptions<SkMcpOptions> options,
    ILogger<ProbeEvaluator> logger) : IProbeEvaluator
{
    private sealed class CallerDecisions
    {
        public required DateTimeOffset Expires { get; init; }
        public ConcurrentDictionary<string, VisibilityDecision> Tools { get; } = new(StringComparer.Ordinal);
        public long LastUsed;
    }

    private readonly ConcurrentDictionary<string, string> _disabled = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, CallerDecisions> _cache = new(StringComparer.Ordinal);
    private long _clock;



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

        TimeSpan lifetime = options.Value.Visibility.ProbeCacheLifetime;
        string? callerKey = lifetime > TimeSpan.Zero ? CallerKey(outerRequest) : null;
        if (callerKey is not null && _cache.TryGetValue(callerKey, out CallerDecisions? caller))
        {
            if (caller.Expires <= DateTimeOffset.UtcNow)
            {
                _cache.TryRemove(callerKey, out _);
            }
            else
            {
                Volatile.Write(ref caller.LastUsed, Interlocked.Increment(ref _clock));
                if (caller.Tools.TryGetValue(entry.Tool.Name, out VisibilityDecision cached))
                {
                    return cached;
                }
            }
        }

        RouteEndpoint endpoint = (RouteEndpoint)entry.Endpoint!;
        string path = ProbePath(endpoint.RoutePattern, options.Value.Visibility.ProbeValues);
        ProbeOutcome outcome = await dispatcher.ProbeAsync(
            new HttpMethod(entry.Descriptor.Method), path, outerRequest, cancellationToken);

        void Remember(VisibilityDecision decision)
        {
            if (callerKey is null)
            {
                return;
            }
            DateTimeOffset now = DateTimeOffset.UtcNow;
            CallerDecisions target = _cache.AddOrUpdate(
                callerKey,
                _ => new CallerDecisions
                {
                    Expires = now + lifetime,
                    LastUsed = Interlocked.Increment(ref _clock),
                },
                (_, existing) => existing.Expires > now
                    ? existing
                    : new CallerDecisions
                    {
                        Expires = now + lifetime,
                        LastUsed = Interlocked.Increment(ref _clock),
                    });
            target.Tools[entry.Tool.Name] = decision;
            Volatile.Write(ref target.LastUsed, Interlocked.Increment(ref _clock));
            Prune(now);
        }

        if (outcome.Status is StatusCodes.Status401Unauthorized or StatusCodes.Status403Forbidden)
        {
            Remember(VisibilityDecision.Deny);
            return VisibilityDecision.Deny;
        }
        if (outcome.ShortCircuited && outcome.Status < 400)
        {
            Remember(VisibilityDecision.Allow);
            return VisibilityDecision.Allow;
        }

        string reason = outcome.Status == StatusCodes.Status404NotFound
            ? "probe path did not route; declare a value in Visibility.ProbeValues for its route parameters"
            : "response came back without the short-circuit marker, so the handler may have run";
        if (_disabled.TryAdd(entry.Tool.Name, reason))
        {
            logger.LogWarning(
                "sk-mcp probe disabled for '{Tool}' ({Method} {Path} -> {Status}): {Reason}",
                entry.Tool.Name, entry.Descriptor.Method, path, outcome.Status, reason);
        }
        return VisibilityDecision.Unknown;
    }

    private void Prune(DateTimeOffset now)
    {
        foreach ((string key, CallerDecisions entry) in _cache)
        {
            if (entry.Expires <= now)
            {
                _cache.TryRemove(key, out _);
            }
        }

        int max = Math.Max(1, options.Value.Visibility.ProbeCacheMaxCallers);
        int excess = _cache.Count - max;
        if (excess <= 0)
        {
            return;
        }
        foreach (KeyValuePair<string, CallerDecisions> pair in _cache
            .OrderBy(entry => Volatile.Read(ref entry.Value.LastUsed))
            .Take(excess)
            .ToList())
        {
            _cache.TryRemove(pair.Key, out _);
        }
    }

    private string CallerKey(HttpRequest? outerRequest)
    {
        StringBuilder identity = new();
        foreach (string carrier in options.Value.Identity.Carriers.OrderBy(c => c, StringComparer.OrdinalIgnoreCase))
        {
            identity.Append(carrier).Append('=');
            if (outerRequest is not null && outerRequest.Headers.TryGetValue(carrier, out var value))
            {
                identity.Append(value.ToString());
            }
            identity.Append('\n');
        }
        byte[] digest = System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(identity.ToString()));
        return Convert.ToHexString(digest);
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
