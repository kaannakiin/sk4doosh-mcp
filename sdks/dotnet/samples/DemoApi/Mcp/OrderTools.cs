using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using SkMcp.AspNetCore;

namespace DemoApi.Mcp;

[McpServerToolType]
public sealed class OrderTools(SkMcpDispatcher dispatcher, IHttpContextAccessor httpContextAccessor)
{
    private static readonly RequestTemplate GetOrderTemplate = RequestTemplate.Create(
        HttpMethod.Get, "/orders/{id}",
        [new ParameterBinding("id", ParameterLocation.Path, ParameterKind.Integer)]);

    private static readonly RequestTemplate AddNoteTemplate = RequestTemplate.Create(
        HttpMethod.Post, "/orders/{id}/notes",
        [
            new ParameterBinding("id", ParameterLocation.Path, ParameterKind.Integer),
            new ParameterBinding("notify", ParameterLocation.Query, ParameterKind.Boolean),
        ],
        bodyProperties: ["text"]);

    [McpServerTool(Name = "get_order", ReadOnly = true)]
    [Description("Bir siparişi id ile getirir. Backend'in gerçek HTTP pipeline'ından geçer; çağıranın token'ında orders.read claim'i olmalıdır.")]
    public Task<string> GetOrder(
        [Description("Sipariş id'si")] int id,
        CancellationToken cancellationToken)
    {
        return DispatchAsync(GetOrderTemplate, new { id }, cancellationToken);
    }

    [McpServerTool(Name = "add_order_note", Destructive = false, Idempotent = false)]
    [Description("Bir siparişe not ekler. Çağıranın token'ında orders.read claim'i olmalıdır.")]
    public Task<string> AddOrderNote(
        [Description("Sipariş id'si")] int id,
        [Description("Not metni")] string text,
        [Description("Sipariş sahibine bildirim gitsin mi")] bool notify = false,
        CancellationToken cancellationToken = default)
    {
        return DispatchAsync(AddNoteTemplate, new { id, text, notify }, cancellationToken);
    }

    private async Task<string> DispatchAsync(
        RequestTemplate template, object arguments, CancellationToken cancellationToken)
    {
        DispatchResult result = await dispatcher.DispatchAsync(
            template,
            JsonSerializer.SerializeToElement(arguments),
            httpContextAccessor.HttpContext?.Request,
            cancellationToken);
        return JsonSerializer.Serialize(result);
    }
}
