using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace SkMcp.AspNetCore.Transport;

internal sealed class ToolCollectionSetup(IOptions<SkMcpOptions> skMcpOptions) : IPostConfigureOptions<McpServerOptions>
{
    public void PostConfigure(string? name, McpServerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        SkMcpToolCollection collection = new();
        IEnumerable<McpServerTool> existing = options.ToolCollection ?? [];
        foreach (McpServerTool tool in existing)
        {
            collection.Add(new SkMcpBudgetTool(tool, skMcpOptions));
        }
        options.ToolCollection = collection;

        options.Capabilities ??= new ServerCapabilities();
        options.Capabilities.Tools ??= new ToolsCapability();
        options.Capabilities.Tools.ListChanged = true;
    }
}
