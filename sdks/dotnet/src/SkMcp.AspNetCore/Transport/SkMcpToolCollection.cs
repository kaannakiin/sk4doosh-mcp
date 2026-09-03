using ModelContextProtocol.Server;

namespace SkMcp.AspNetCore.Transport;

internal sealed class SkMcpToolCollection() : McpServerPrimitiveCollection<McpServerTool>(StringComparer.Ordinal)
{
    public void NotifyChanged() => RaiseChanged();
}
