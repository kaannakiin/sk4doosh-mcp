using Liaiso.AspNetCore.Visibility;

namespace Liaiso.AspNetCore.Caching;

public interface ILiaisoCacheInvalidator
{
    ValueTask InvalidateCallerAsync(CallerScope scope, CancellationToken cancellationToken = default);

    ValueTask InvalidateTagAsync(string tag, CancellationToken cancellationToken = default);

    ValueTask InvalidateAllAsync(CancellationToken cancellationToken = default);
}

internal sealed class LiaisoCacheInvalidator(ILiaisoCache cache, CallerVisibilityProvider visibility) : ILiaisoCacheInvalidator
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
