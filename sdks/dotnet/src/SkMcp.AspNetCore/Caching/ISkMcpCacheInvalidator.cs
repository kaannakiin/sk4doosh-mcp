using SkMcp.AspNetCore.Visibility;

namespace SkMcp.AspNetCore.Caching;

public interface ISkMcpCacheInvalidator
{
    ValueTask InvalidateCallerAsync(CallerScope scope, CancellationToken cancellationToken = default);

    ValueTask InvalidateTagAsync(string tag, CancellationToken cancellationToken = default);

    ValueTask InvalidateAllAsync(CancellationToken cancellationToken = default);
}

internal sealed class SkMcpCacheInvalidator(ISkMcpCache cache, CallerVisibilityProvider visibility) : ISkMcpCacheInvalidator
{
    public ValueTask InvalidateCallerAsync(CallerScope scope, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(scope);
        visibility.Bump();
        return cache.RemoveScopeAsync(scope.Key, cancellationToken);
    }

    public ValueTask InvalidateTagAsync(string tag, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tag);
        visibility.Bump();
        return cache.RemoveTagAsync(tag, cancellationToken);
    }

    public ValueTask InvalidateAllAsync(CancellationToken cancellationToken = default)
    {
        visibility.Bump();
        return cache.ClearAsync(cancellationToken);
    }
}
