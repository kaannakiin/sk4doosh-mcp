using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Liaiso.AspNetCore.Discovery;

namespace DemoApi.Controllers;

public sealed record OrderPatch([property: Description("New quantity")] int? Quantity);

[ApiController]
[McpTool]
public sealed class AttachmentsController : ControllerBase
{
    [HttpPost("/orders/{id:int}/attachments")]
    [Authorize(Policy = "OrdersRead")]
    [Description("Attaches a file to an order.")]
    public IActionResult Attach([Description("Order id")] int id, IFormFile attachment, [FromForm] string? note) =>
        Ok(new
        {
            orderId = id,
            note,
            file = new { name = attachment.FileName, type = attachment.ContentType, size = attachment.Length },
        });

    [HttpPatch("/orders/{id:int}")]
    [Authorize(Policy = "OrdersRead")]
    [Consumes("application/merge-patch+json")]
    [Description("Changes an order's quantity as a JSON merge patch.")]
    public IActionResult Patch([Description("Order id")] int id, [FromBody] OrderPatch patch) =>
        Ok(new { id, patch.Quantity, contentType = Request.ContentType });
}
