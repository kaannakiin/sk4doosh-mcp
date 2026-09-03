using System.Collections.Concurrent;

namespace SkMcp.AspNetCore.Caching;

internal sealed class SingleFlight<TValue>
{
    private readonly ConcurrentDictionary<string, Task<TValue>> _inFlight = new(StringComparer.Ordinal);

    public async Task<TValue> RunAsync(string key, Func<CancellationToken, Task<TValue>> work, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        ArgumentNullException.ThrowIfNull(work);

        TaskCompletionSource<TValue> candidate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        Task<TValue> flight = _inFlight.GetOrAdd(key, candidate.Task);

        if (ReferenceEquals(flight, candidate.Task))
        {
            try
            {
                candidate.SetResult(await work(CancellationToken.None).ConfigureAwait(false));
            }
            catch (Exception ex)
            {
                candidate.SetException(ex);
            }
            finally
            {
                _inFlight.TryRemove(new KeyValuePair<string, Task<TValue>>(key, flight));
            }
        }

        return await flight.WaitAsync(cancellationToken).ConfigureAwait(false);
    }
}
