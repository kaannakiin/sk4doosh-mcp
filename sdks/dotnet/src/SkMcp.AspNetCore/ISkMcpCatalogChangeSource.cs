using Microsoft.Extensions.Primitives;

namespace SkMcp.AspNetCore;

public interface ISkMcpCatalogChangeSource
{
    long Generation { get; }

    IChangeToken GetChangeToken();

    ValueTask ReloadAsync(CancellationToken cancellationToken = default);
}
