using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using SkMcp.AspNetCore.Errors;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Transport;

/// <summary>
/// The backstop for the payload budget. <c>SkMcpMetaTools.Respond</c> is the primary gate, but
/// <c>[McpServerToolType]</c> turns any method added to that type later into a tool that skips it.
/// This wrapper sees the final <see cref="CallToolResult"/>, so nothing registered on the server can
/// reach the agent over budget. Pinned by ResponseBudgetTests.
/// </summary>
internal sealed class SkMcpBudgetTool(McpServerTool inner, IOptions<SkMcpOptions> options)
    : DelegatingMcpServerTool(inner)
{
    public override async ValueTask<CallToolResult> InvokeAsync(
        RequestContext<CallToolRequestParams> request,
        CancellationToken cancellationToken = default)
    {
        CallToolResult result = await base.InvokeAsync(request, cancellationToken).ConfigureAwait(false);
        int limit = options.Value.Invoke.MaxResponseBytes;
        int bytes = 0;
        foreach (ContentBlock block in result.Content)
        {
            if (block is TextContentBlock text)
            {
                bytes += Encoding.UTF8.GetByteCount(text.Text);
            }
        }
        if (bytes <= limit)
        {
            return result;
        }
        SdkError refusal = SdkErrors.RefuseOversize(new OversizeResponse(
            bytes,
            limit,
            new PayloadShape { Kind = PayloadShapeKind.Text, Count = bytes },
            null));
        return new CallToolResult
        {
            IsError = true,
            Content = [new TextContentBlock { Text = JsonSerializer.Serialize(refusal, SkMcpJson.Wire) }],
        };
    }
}
