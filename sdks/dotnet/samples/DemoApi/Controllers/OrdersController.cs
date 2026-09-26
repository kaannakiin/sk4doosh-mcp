using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Liaiso.AspNetCore.Discovery;

namespace DemoApi.Controllers;

public sealed record AddNoteRequest([Required][property: Description("Note text")] string Text);

public sealed record OrderResponse(
    [Required] int Id,
    [Required] string Item,
    [Required] int Quantity,
    [Required] string Owner);

/// <remarks>
/// A whole-object query binding, so the sample exercises <c>Query.Grouping</c> end to end. The
/// action echoes the DTO the model binder produced, which is the only direct evidence that the
/// key the composer wrote is the key the backend actually read.
/// </remarks>
public sealed class OrderFilter
{
    [Description("Order owner")]
    public string? Owner { get; set; }

    [Description("Smallest quantity to return")]
    public int? MinQuantity { get; set; }

    [Description("Item names to match")]
    public List<string>? Items { get; set; }
}

public sealed record CreateOrderRequest(
    [Required, MinLength(1)][property: Description("Item name")] string Item,
    [Range(1, 100)][property: Description("Quantity")] int Quantity);

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
    [Description("Health check; requires no identity.")]
    public IActionResult Ping() => Ok(new { pong = true });

    [HttpGet("/me")]
    [Authorize]
    [Description("Returns the caller's identity.")]
    public IActionResult Me() => Ok(new { name = User.Identity?.Name });

    [HttpGet("/orders/{id:int}")]
    [Authorize(Policy = "OrdersRead")]
    [ProducesResponseType(typeof(OrderResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [Description("Fetches one order by id.")]
    public IActionResult GetOrder([Description("Order id")] int id) =>
        Orders.TryGetValue(id, out var order) ? Ok(order) : NotFound();

    [HttpGet("/orders")]
    [Authorize(Policy = "OrdersRead")]
    [Description("Searches orders by a filter object, echoing the filter the binder produced.")]
    public IActionResult Search(
        [FromQuery] OrderFilter filter,
        [Description("Largest number of orders to return")] int? take)
    {
        object[] matched = [.. Orders.Values
            .Where(order => Match(order, filter))
            .Take(take ?? 10)];
        return Ok(new { echoed = filter, take, matched });
    }

    /// <remarks>
    /// The same binding with an explicit binder name, which the model binder reads as
    /// <c>f.Owner</c>. Flattened, the tool composes <c>?Owner=</c> and the DTO arrives empty;
    /// grouped, it composes <c>?f.Owner=</c> and binds. The echo shows which one happened.
    /// </remarks>
    [HttpGet("/orders/aliased")]
    [Authorize(Policy = "OrdersRead")]
    [Description("Searches orders through an aliased filter object; echoes what bound.")]
    public IActionResult SearchAliased([FromQuery(Name = "f")] OrderFilter filter) =>
        Ok(new { echoed = filter });

    private static bool Match(object order, OrderFilter filter)
    {
        Type shape = order.GetType();
        string owner = (string)shape.GetProperty("owner")!.GetValue(order)!;
        string item = (string)shape.GetProperty("item")!.GetValue(order)!;
        int quantity = (int)shape.GetProperty("quantity")!.GetValue(order)!;
        return (filter.Owner is null || filter.Owner == owner)
            && (filter.MinQuantity is null || quantity >= filter.MinQuantity)
            && (filter.Items is null || filter.Items.Count == 0 || filter.Items.Contains(item));
    }

    [HttpGet("/orders/{id:int}/receipt")]
    [Authorize]
    [Description("Returns an order's receipt; only the order's owner may see it.")]
    public IActionResult GetReceipt([Description("Order id")] int id)
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
    [Description("Audit log; admin role only.")]
    public IActionResult Audit() => Ok(new { entries = Notes.Count });

    [HttpGet("/reports/summary")]
    [Authorize(Policy = "BusinessHours")]
    [Description("Daily summary; closed outside business hours.")]
    public IActionResult Summary() => Ok(new { orders = Orders.Count });

    [HttpPost("/orders/{id:int}/notes")]
    [EndpointName("AddOrderNote")]
    [Authorize(Policy = "OrdersRead")]
    [Description("Adds a note to an order.")]
    public IActionResult AddNote(
        [Description("Order id")] int id,
        [FromQuery, Description("Whether to notify the order's owner")] bool notify,
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
    [Description("Creates a new order.")]
    public IActionResult CreateOrder([FromBody] CreateOrderRequest request)
    {
        int id = Orders.Count == 0 ? 1 : Orders.Keys.Max() + 1;
        var order = new { id, item = request.Item, quantity = request.Quantity, owner = User.Identity?.Name };
        Orders[id] = order;
        return Ok(order);
    }
}
