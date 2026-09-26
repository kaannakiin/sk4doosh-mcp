using Microsoft.Extensions.Primitives;

namespace Liaiso.AspNetCore;

public interface ILiaisoCatalogChangeSource
{
    long Generation { get; }

    IChangeToken GetChangeToken();

    ValueTask ReloadAsync(CancellationToken cancellationToken = default);
}
