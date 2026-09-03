using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SkMcp.AspNetCore.Discovery;

namespace DemoApi.Controllers;

public sealed record AddNoteRequest([Required][property: Description("Not metni")] string Text);

public sealed record CreateOrderRequest(
    [Required, MinLength(1)][property: Description("Ürün adı")] string Item,
    [Range(1, 100)][property: Description("Adet")] int Quantity);

[ApiController]
[McpTool]
public sealed class OrdersController : ControllerBase
{
    private static readonly Dictionary<int, object> Orders = new()
    {
        [1] = new { id = 1, item = "mechanical keyboard", quantity = 2, owner = "alice" },
        [2] = new { id = 2, item = "usb-c dock", quantity = 1, owner = "bob" },
    };

    private static readonly Dictionary<int, List<string>> Notes = [];

    [HttpGet("/ping")]
    [AllowAnonymous]
    [Description("Sağlık kontrolü; kimlik gerektirmez.")]
    public IActionResult Ping() => Ok(new { pong = true });

    [HttpGet("/me")]
    [Authorize]
    [Description("Çağıranın kimliğini döner.")]
    public IActionResult Me() => Ok(new { name = User.Identity?.Name });

    [HttpGet("/orders/{id:int}")]
    [Authorize(Policy = "OrdersRead")]
    [Description("Bir siparişi id ile getirir.")]
    public IActionResult GetOrder([Description("Sipariş id'si")] int id) =>
        Orders.TryGetValue(id, out var order) ? Ok(order) : NotFound();

    [HttpGet("/orders/{id:int}/receipt")]
    [Authorize]
    [Description("Siparişin fişini döner; yalnız sipariş sahibi görebilir.")]
    public IActionResult GetReceipt([Description("Sipariş id'si")] int id)
    {
        if (!Orders.TryGetValue(id, out var order))
        {
            return NotFound();
        }
        string? owner = order.GetType().GetProperty("owner")?.GetValue(order) as string;
        return owner == User.Identity?.Name ? Ok(new { id, receipt = $"receipt-{id}" }) : Forbid();
    }

    [HttpGet("/admin/audit")]
    [Authorize(Roles = "admin")]
    [Description("Denetim kaydı; yalnız admin rolü.")]
    public IActionResult Audit() => Ok(new { entries = Notes.Count });

    [HttpGet("/reports/summary")]
    [Authorize(Policy = "BusinessHours")]
    [Description("Günlük özet; mesai saatleri dışında kapalı.")]
    public IActionResult Summary() => Ok(new { orders = Orders.Count });

    [HttpPost("/orders/{id:int}/notes")]
    [EndpointName("AddOrderNote")]
    [Authorize(Policy = "OrdersRead")]
    [Description("Bir siparişe not ekler.")]
    public IActionResult AddNote(
        [Description("Sipariş id'si")] int id,
        [FromQuery, Description("Sipariş sahibine bildirim gitsin mi")] bool notify,
        [FromBody] AddNoteRequest request)
    {
        if (!Orders.ContainsKey(id))
        {
            return NotFound();
        }
        if (!Notes.TryGetValue(id, out List<string>? list))
        {
            Notes[id] = list = [];
        }
        list.Add(request.Text);
        return Ok(new { id, notes = list, notified = notify });
    }

    [HttpPost("/orders")]
    [EndpointName("CreateOrder")]
    [Authorize(Policy = "OrdersRead")]
    [Description("Yeni bir sipariş oluşturur.")]
    public IActionResult CreateOrder([FromBody] CreateOrderRequest request)
    {
        int id = Orders.Count == 0 ? 1 : Orders.Keys.Max() + 1;
        var order = new { id, item = request.Item, quantity = request.Quantity, owner = User.Identity?.Name };
        Orders[id] = order;
        return Ok(order);
    }
}
