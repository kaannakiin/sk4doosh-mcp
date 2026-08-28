using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DemoApi.Controllers;

public sealed record AddNoteRequest(string Text);

[ApiController]
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
    public IActionResult Ping() => Ok(new { pong = true });

    [HttpGet("/me")]
    [Authorize]
    public IActionResult Me() => Ok(new { name = User.Identity?.Name });

    [HttpGet("/orders/{id:int}")]
    [Authorize(Policy = "OrdersRead")]
    public IActionResult GetOrder(int id) =>
        Orders.TryGetValue(id, out var order) ? Ok(order) : NotFound();

    [HttpPost("/orders/{id:int}/notes")]
    [Authorize(Policy = "OrdersRead")]
    public IActionResult AddNote(int id, [FromQuery] bool notify, [FromBody] AddNoteRequest request)
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
}
