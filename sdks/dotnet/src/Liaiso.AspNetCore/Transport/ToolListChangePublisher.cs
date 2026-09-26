using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Liaiso.AspNetCore.Transport;

internal sealed class ToolListChangePublisher : IDisposable
{
    public const string GenerationMetaKey = "liaiso/catalogGeneration";

    private readonly ILiaisoCatalogChangeSource _source;
    private readonly IOptions<McpServerOptions> _serverOptions;
    private readonly IDisposable _subscription;

    public ToolListChangePublisher(ILiaisoCatalogChangeSource source, IOptions<McpServerOptions> serverOptions)
    {
        _source = source;
        _serverOptions = serverOptions;
        StampGeneration();
        _subscription = ChangeToken.OnChange(_source.GetChangeToken, OnChanged);
    }

    public void Dispose() => _subscription.Dispose();

    private void OnChanged()
    {
        StampGeneration();
        if (_serverOptions.Value.ToolCollection is LiaisoToolCollection collection)
        {
            collection.NotifyChanged();
        }
    }

    private void StampGeneration()
    {
        long generation = _source.Generation;
        IEnumerable<McpServerTool> tools = _serverOptions.Value.ToolCollection ?? [];
        foreach (McpServerTool tool in tools)
        {
            Tool protocolTool = tool.ProtocolTool;
            JsonObject meta = protocolTool.Meta is { } existing
                ? new JsonObject(existing.Select(pair => KeyValuePair.Create(pair.Key, pair.Value?.DeepClone())))
                : new JsonObject();
            meta[GenerationMetaKey] = generation;
            protocolTool.Meta = meta;
        }
    }
}
