using System.Reflection;
using Microsoft.AspNetCore.Http;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Naming;

namespace SkMcp.AspNetCore;

public sealed class SkMcpOptions
{
    public IdentityForwardingOptions Identity { get; } = new();
    public SyntheticRequestOptions Synthetic { get; } = new();
    public SelectionOptions Selection { get; } = new();
    public SchemaOptions Schema { get; } = new();
    public NamingOptions Naming { get; } = new();
    public VisibilityOptions Visibility { get; } = new();
}

public enum UnknownVisibility { Show, Hide }

public enum VisibilityTier { Declarative, Probe }

public sealed class VisibilityOptions
{
    public UnknownVisibility OnUnknown { get; set; } = UnknownVisibility.Show;
    public VisibilityTier Tier { get; set; } = VisibilityTier.Declarative;
    public int ProbeTopK { get; set; } = 25;
    public int ProbeConcurrency { get; set; } = 4;
    public TimeSpan ProbeCacheLifetime { get; set; } = TimeSpan.FromSeconds(30);
    public int ProbeCacheMaxCallers { get; set; } = 128;
    public Dictionary<string, string> ProbeValues { get; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class SelectionOptions
{
    public SelectionDefault Default { get; set; } = SelectionDefault.Exclude;
}

public sealed class NamingOptions
{
    public PrefixMode PrefixMode { get; set; } = PrefixMode.Always;
    public Func<string, string?>? Prefix { get; set; }
}

public sealed class SchemaOptions
{
    public Func<PropertyInfo, string>? PropertyName { get; set; }
}

public sealed class SyntheticRequestOptions
{
    public string? Host { get; set; }
    public string? Scheme { get; set; }
    public string Accept { get; set; } = "application/json";
    public string? UserAgent { get; set; }
}

public sealed class IdentityForwardingOptions
{
    private readonly HashSet<string> _carriers = new(StringComparer.OrdinalIgnoreCase) { "Authorization" };

    public IReadOnlyCollection<string> Carriers => _carriers;

    public Action<HttpRequest, HttpRequest>? Projector { get; private set; }

    public IdentityForwardingOptions Forward(string headerName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(headerName);
        _carriers.Add(headerName);
        return this;
    }

    public IdentityForwardingOptions Clear()
    {
        _carriers.Clear();
        return this;
    }

    public IdentityForwardingOptions Project(Action<HttpRequest, HttpRequest> projector)
    {
        ArgumentNullException.ThrowIfNull(projector);
        Projector = projector;
        return this;
    }
}
