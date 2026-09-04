using System.Collections.Concurrent;
using Microsoft.Extensions.Options;

namespace SkMcp.AspNetCore.Caching;

internal sealed class MemorySkMcpCache(IOptions<SkMcpOptions> options, TimeProvider timeProvider) : ISkMcpCache
{
    private sealed class ScopeEntry
    {
        public required DateTimeOffset Expires { get; init; }
        public required IReadOnlyList<string> Tags { get; init; }
        public ConcurrentDictionary<string, string> Values { get; } = new(StringComparer.Ordinal);
        public long LastUsed;
    }

    private ConcurrentDictionary<string, ScopeEntry> _scopes = new(StringComparer.Ordinal);
    private ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> _tags = new(StringComparer.Ordinal);
    private long _clock;

    public ValueTask<string?> GetAsync(CacheKey key, CancellationToken cancellationToken)
    {
        ConcurrentDictionary<string, ScopeEntry> scopes = Volatile.Read(ref _scopes);
        if (!scopes.TryGetValue(key.Scope.Key, out ScopeEntry? entry))
        {
            return new ValueTask<string?>((string?)null);
        }

        DateTimeOffset now = timeProvider.GetUtcNow();
        if (entry.Expires <= now)
        {
            Evict(scopes, key.Scope.Key, entry);
            return new ValueTask<string?>((string?)null);
        }

        Volatile.Write(ref entry.LastUsed, Interlocked.Increment(ref _clock));
        return new ValueTask<string?>(
            entry.Values.TryGetValue(key.ToString(), out string? value) ? value : null);
    }

    public ValueTask SetAsync(CacheKey key, string value, TimeSpan lifetime, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(value);

        ConcurrentDictionary<string, ScopeEntry> scopes = Volatile.Read(ref _scopes);
        DateTimeOffset now = timeProvider.GetUtcNow();
        bool admitted = false;

        ScopeEntry entry = scopes.AddOrUpdate(
            key.Scope.Key,
            _ =>
            {
                admitted = true;
                return new ScopeEntry { Expires = now + lifetime, Tags = key.Scope.Tags };
            },
            (_, existing) =>
            {
                if (existing.Expires > now)
                {
                    return existing;
                }
                admitted = true;
                return new ScopeEntry { Expires = now + lifetime, Tags = key.Scope.Tags };
            });

        entry.Values[key.ToString()] = value;
        Volatile.Write(ref entry.LastUsed, Interlocked.Increment(ref _clock));
        IndexTags(key.Scope.Key, entry.Tags);

        if (admitted)
        {
            Admit(scopes);
        }
        return ValueTask.CompletedTask;
    }

    public ValueTask RemoveScopeAsync(string scopeKey, CancellationToken cancellationToken)
    {
        ConcurrentDictionary<string, ScopeEntry> scopes = Volatile.Read(ref _scopes);
        if (scopes.TryRemove(scopeKey, out ScopeEntry? entry))
        {
            RemoveFromTagIndex(scopeKey, entry.Tags);
        }
        return ValueTask.CompletedTask;
    }

    public ValueTask RemoveTagAsync(string tag, CancellationToken cancellationToken)
    {
        if (Volatile.Read(ref _tags).TryRemove(tag, out ConcurrentDictionary<string, byte>? scopeKeys))
        {
            ConcurrentDictionary<string, ScopeEntry> scopes = Volatile.Read(ref _scopes);
            foreach (string scopeKey in scopeKeys.Keys)
            {
                scopes.TryRemove(scopeKey, out _);
            }
        }
        return ValueTask.CompletedTask;
    }

    public ValueTask ClearAsync(CancellationToken cancellationToken)
    {
        Interlocked.Exchange(ref _scopes, new ConcurrentDictionary<string, ScopeEntry>(StringComparer.Ordinal));
        Interlocked.Exchange(
            ref _tags, new ConcurrentDictionary<string, ConcurrentDictionary<string, byte>>(StringComparer.Ordinal));
        return ValueTask.CompletedTask;
    }

    private void Admit(ConcurrentDictionary<string, ScopeEntry> scopes)
    {
        DateTimeOffset now = timeProvider.GetUtcNow();
        foreach ((string scopeKey, ScopeEntry entry) in scopes)
        {
            if (entry.Expires <= now)
            {
                Evict(scopes, scopeKey, entry);
            }
        }

        int max = Math.Max(1, options.Value.Cache.MaxCallers);
        int excess = scopes.Count - max;
        if (excess <= 0)
        {
            return;
        }
        foreach ((string scopeKey, ScopeEntry entry) in scopes
            .OrderBy(pair => Volatile.Read(ref pair.Value.LastUsed))
            .Take(excess)
            .ToList())
        {
            Evict(scopes, scopeKey, entry);
        }
    }

    private void Evict(ConcurrentDictionary<string, ScopeEntry> scopes, string scopeKey, ScopeEntry entry)
    {
        if (scopes.TryRemove(new KeyValuePair<string, ScopeEntry>(scopeKey, entry)))
        {
            RemoveFromTagIndex(scopeKey, entry.Tags);
        }
    }

    private void IndexTags(string scopeKey, IReadOnlyList<string> tags)
    {
        ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> tagIndex = Volatile.Read(ref _tags);
        foreach (string tag in tags)
        {
            tagIndex.GetOrAdd(tag, _ => new ConcurrentDictionary<string, byte>(StringComparer.Ordinal))[scopeKey] = 0;
        }
    }

    private void RemoveFromTagIndex(string scopeKey, IReadOnlyList<string> tags)
    {
        ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> tagIndex = Volatile.Read(ref _tags);
        foreach (string tag in tags)
        {
            if (tagIndex.TryGetValue(tag, out ConcurrentDictionary<string, byte>? scopeKeys))
            {
                scopeKeys.TryRemove(scopeKey, out _);
            }
        }
    }
}
