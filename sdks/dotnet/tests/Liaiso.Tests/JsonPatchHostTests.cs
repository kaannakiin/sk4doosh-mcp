using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Liaiso.AspNetCore.Discovery;
using NewtonsoftPatch = Microsoft.AspNetCore.JsonPatch.JsonPatchDocument<Liaiso.Tests.PatchedOrder>;

namespace Liaiso.Tests;

internal static class Patches
{
    public static readonly object Shipped = new
    {
        body = new object[]
        {
            new { op = "test", path = "/status", value = "open" },
            new { op = "replace", path = "/status", value = "shipped" },
        },
    };

    public static void AssertOperations(JsonNode inputSchema)
    {
        JsonNode? body = inputSchema["properties"]!["body"];
        Assert.True(
            JsonNode.DeepEquals(JsonNode.Parse(JsonPatchSchemaTests.OperationsSchema), body),
            body?.ToJsonString());
    }
}

public sealed class NewtonsoftJsonPatchHostTests : InvokeHost
{
    [ApiController]
    [Route("/host-patch")]
    public sealed class OrdersController : ControllerBase
    {
        [HttpPatch("orders")]
        [Consumes("application/json-patch+json")]
        [McpTool(Name = "patch_order")]
        public IActionResult Patch([FromBody] NewtonsoftPatch patch)
        {
            PatchedOrder order = new() { Status = "open" };
            patch.ApplyTo(order);
            return Ok(new { order.Status, Type = Request.ContentType });
        }
    }

    protected override Type[] Controllers => [typeof(OrdersController)];

    protected override void Configure(IMvcBuilder mvc) => mvc.AddNewtonsoftJson();

    [Fact]
    public async Task JH1_TheNewtonsoftFlavourPublishesTheOperationArray() =>
        Patches.AssertOperations(await LoadInputSchemaAsync("patch_order"));

    [Fact]
    public async Task JH2_TheNewtonsoftFlavourAppliesTheOperationsItWasSent()
    {
        JsonElement body = await InvokeAsync("patch_order", Patches.Shipped);
        Assert.Equal("shipped", body.GetProperty("status").GetString());
        Assert.Equal("application/json-patch+json; charset=utf-8", body.GetProperty("type").GetString());
    }
}

#if NET10_0_OR_GREATER
public sealed class SystemTextJsonPatchHostTests : InvokeHost
{
    [ApiController]
    [Route("/host-patch")]
    public sealed class OrdersController : ControllerBase
    {
        [HttpPatch("orders")]
        [Consumes("application/json-patch+json")]
        [McpTool(Name = "patch_order")]
        public IActionResult Patch(
            [FromBody] Microsoft.AspNetCore.JsonPatch.SystemTextJson.JsonPatchDocument<PatchedOrder> patch)
        {
            PatchedOrder order = new() { Status = "open" };
            patch.ApplyTo(order);
            return Ok(new { order.Status, Type = Request.ContentType });
        }
    }

    protected override Type[] Controllers => [typeof(OrdersController)];

    protected override void Map(WebApplication app) =>
        app.MapPatch(
                "/host-patch/minimal",
                (Microsoft.AspNetCore.JsonPatch.SystemTextJson.JsonPatchDocument<PatchedOrder> patch, HttpRequest request) =>
                {
                    PatchedOrder order = new() { Status = "open" };
                    patch.ApplyTo(order);
                    return new { order.Status, type = request.ContentType };
                })
            .WithMetadata(new McpToolAttribute { Name = "patch_minimal" });

    [Theory]
    [InlineData("patch_order")]
    [InlineData("patch_minimal")]
    public async Task JH3_TheSystemTextJsonFlavourPublishesTheOperationArray(string name) =>
        Patches.AssertOperations(await LoadInputSchemaAsync(name));

    [Theory]
    [InlineData("patch_order", "application/json-patch+json; charset=utf-8")]
    [InlineData("patch_minimal", "application/json-patch+json; charset=utf-8")]
    public async Task JH4_TheSystemTextJsonFlavourAppliesTheOperationsItWasSent(string name, string contentType)
    {
        JsonElement body = await InvokeAsync(name, Patches.Shipped);
        Assert.Equal("shipped", body.GetProperty("status").GetString());
        Assert.Equal(contentType, body.GetProperty("type").GetString());
    }
}
#endif
