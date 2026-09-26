using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Liaiso.AspNetCore.Transport;

internal sealed class ToolCollectionSetup(IOptions<LiaisoOptions> liaisoOptions) : IPostConfigureOptions<McpServerOptions>
{
    public void PostConfigure(string? name, McpServerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        LiaisoToolCollection collection = new();
        IEnumerable<McpServerTool> existing = options.ToolCollection ?? [];
        foreach (McpServerTool tool in existing)
        {
            collection.Add(new LiaisoBudgetTool(tool, liaisoOptions));
        }
        options.ToolCollection = collection;

        options.Capabilities ??= new ServerCapabilities();
        options.Capabilities.Tools ??= new ToolsCapability();
        options.Capabilities.Tools.ListChanged = true;
    }
}
