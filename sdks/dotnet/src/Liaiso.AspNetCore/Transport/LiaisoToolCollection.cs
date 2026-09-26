using ModelContextProtocol.Server;

namespace Liaiso.AspNetCore.Transport;

internal sealed class LiaisoToolCollection() : McpServerPrimitiveCollection<McpServerTool>(StringComparer.Ordinal)
{
    public void NotifyChanged() => RaiseChanged();
}
