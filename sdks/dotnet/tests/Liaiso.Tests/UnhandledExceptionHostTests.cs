using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Liaiso.AspNetCore;
using Liaiso.AspNetCore.Discovery;

namespace Liaiso.Tests;

public sealed class UnhandledExceptionHostTests : InvokeHost
{
    private const string Secret = "password=hunter2 at OrderService.Charge";

    [ApiController]
    [Route("/host-boom")]
    public sealed class BoomController : ControllerBase
    {
        [HttpGet("controller")]
        [McpTool(Name = "boom_controller")]
        public IActionResult Boom()
        {
            Response.Headers["X-Leaky"] = Secret;
            throw new InvalidOperationException(Secret);
        }
    }

    protected override Type[] Controllers => [typeof(BoomController)];

    protected override void Map(WebApplication app)
    {
        app.Use(next => context => context.Request.Path == "/host-boom/middleware"
            ? throw new InvalidOperationException(Secret)
            : next(context));
        app.MapGet("/host-boom/minimal", string () => throw new InvalidOperationException(Secret))
            .WithMetadata(new McpToolAttribute { Name = "boom_minimal" });
        app.MapGet("/host-boom/middleware", () => "unreached")
            .WithMetadata(new McpToolAttribute { Name = "boom_middleware" });
        app.MapGet("/host-boom/fine", () => "ok")
            .WithMetadata(new McpToolAttribute { Name = "fine" });
    }

    [Theory]
    [InlineData("boom_controller")]
    [InlineData("boom_minimal")]
    [InlineData("boom_middleware")]
    public async Task UX1_AHandlerExceptionIsABackendErrorWithItsMessageWithheld(string name)
    {
        (JsonElement raw, bool isError) = await InvokeRawAsync(name, new { });
        Assert.True(isError);
        Assert.Equal("backend_error", raw.GetProperty("error").GetString());
        Assert.Equal(500, raw.GetProperty("status").GetInt32());
        Assert.False(raw.GetProperty("retryable").GetBoolean());
        Assert.DoesNotContain("hunter2", raw.GetRawText(), StringComparison.Ordinal);
        Assert.DoesNotContain("liaiso layer", raw.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task UX2_TheHostKeepsServingAfterAHandlerException()
    {
        await InvokeRawAsync("boom_minimal", new { });
        Assert.Equal("ok", (await InvokeAsync("fine", new { })).GetString());
    }

    [Fact]
    public async Task UX3_AProbeThatHitsAThrowingPipelineComesBackAsA500()
    {
        ProbeOutcome outcome = await Services.GetRequiredService<LiaisoDispatcher>().ProbeAsync(
            HttpMethod.Get, "/host-boom/middleware", null, CancellationToken.None);
        Assert.Equal(StatusCodes.Status500InternalServerError, outcome.Status);
        Assert.False(outcome.ShortCircuited);
    }
}
