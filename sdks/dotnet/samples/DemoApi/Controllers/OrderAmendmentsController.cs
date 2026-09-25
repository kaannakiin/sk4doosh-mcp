using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.JsonPatch.SystemTextJson;
using Microsoft.AspNetCore.Mvc;
using SkMcp.AspNetCore.Discovery;

namespace DemoApi.Controllers;

public sealed class OrderDraft
{
    public int Quantity { get; set; } = 1;
    public string Status { get; set; } = "open";
    public List<string> Notes { get; set; } = [];
}

[ApiController]
[McpTool]
public sealed class OrderAmendmentsController : ControllerBase
{
    [HttpPatch("/orders/{id:int}/draft")]
    [Authorize(Policy = "OrdersRead")]
    [Consumes("application/json-patch+json")]
    [Description("Amends an order draft with JSON Patch operations.")]
    [Tags("Orders", "Amendments")]
    public IActionResult Amend([Description("Order id")] int id, [FromBody] JsonPatchDocument<OrderDraft> patch)
    {
        OrderDraft draft = new();
        patch.ApplyTo(draft, error => ModelState.AddModelError(error.Operation.path ?? "patch", error.ErrorMessage));
        return ModelState.IsValid
            ? Ok(new { id, draft, contentType = Request.ContentType })
            : ValidationProblem(ModelState);
    }
}
