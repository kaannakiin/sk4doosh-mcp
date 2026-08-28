using Microsoft.AspNetCore.Http;

namespace SkMcp.AspNetCore;

public sealed class SkMcpOptions
{
    public IdentityForwardingOptions Identity { get; } = new();
    public SyntheticRequestOptions Synthetic { get; } = new();
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
