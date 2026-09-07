using System.ComponentModel;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Naming;

namespace SkMcp.Tests;

public sealed record HostPayload(string FirstName, [property: JsonPropertyName("x_code")] string Code);

[ApiController]
[Route("/host/alpha")]
[McpTool(Destructive = true)]
public sealed class AlphaController : ControllerBase
{
    [HttpGet("one")]
    [Description("alpha one")]
    public IActionResult AlphaOne() => Ok();

    [HttpGet("two")]
    [McpIgnore]
    public IActionResult AlphaTwo() => Ok();

    [HttpPost("three")]
    [McpTool(Destructive = false, Idempotent = true)]
    public IActionResult AlphaThree([FromBody] HostPayload payload) => Ok(payload);
}

[ApiController]
[Route("/host/beta")]
public sealed class BetaController : ControllerBase
{
    [HttpGet("one")]
    public IActionResult BetaOne() => Ok();

    [HttpGet("two")]
    [McpTool]
    [EndpointName("BetaCustom")]
    public IActionResult BetaTwo() => Ok();
}

[ApiController]
[Route("/host/gamma")]
[McpTool]
public sealed class GammaController : ControllerBase
{
    [HttpGet("list")]
    public IActionResult List() => Ok();
}

public sealed class CatalogHostTests : IAsyncLifetime
{
    private WebApplication _app = null!;
    private SkMcpCatalogProvider _catalog = null!;

    public async Task InitializeAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(CatalogHostTests).Assembly);
        builder.Services.AddSkMcp();

        _app = builder.Build();
        _app.UseSkMcpCapture();
        _app.UseRouting();
        _app.MapControllers();
        _app.MapGet("/probe", () => "ok")
            .WithMetadata(new McpToolAttribute(), new EndpointDescriptionAttribute("probe description"));
        _app.MapGet("/mcp/inside", () => "hidden")
            .WithMetadata(new McpToolAttribute());
        _app.MapSkMcp("/mcp");
        await _app.StartAsync();

        _catalog = _app.Services.GetRequiredService<SkMcpCatalogProvider>();
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    [Fact]
    public void C6_SelectionHierarchy_ThroughRealAttributes()
    {
        string[] names = _catalog.Result.Entries
            .Where(e => e.Descriptor.Route.StartsWith("/host/", StringComparison.Ordinal)
                || e.Descriptor.Route.StartsWith("/probe", StringComparison.Ordinal))
            .Select(e => e.Tool.Name)
            .Order(StringComparer.Ordinal)
            .ToArray();
        Assert.Equal(["alpha_one", "alpha_three", "beta_custom", "gamma_list", "get_probe"], names);
        Assert.Empty(_catalog.Result.Diagnostics);
    }

    [Fact]
    public void C7_AnnotationOverrides_MostSpecificWins()
    {
        var one = _catalog.Find("alpha_one")!.Tool.Annotations;
        Assert.True(one.ReadOnlyHint);
        Assert.True(one.DestructiveHint);
        Assert.True(one.IdempotentHint);

        var three = _catalog.Find("alpha_three")!.Tool.Annotations;
        Assert.Null(three.ReadOnlyHint);
        Assert.False(three.DestructiveHint);
        Assert.True(three.IdempotentHint);
    }

    [Fact]
    public void C8_DescriptionSources_AttributeAndEndpointMetadata()
    {
        Assert.Equal("alpha one", _catalog.Find("alpha_one")!.Tool.Description);
        Assert.Equal("probe description", _catalog.Find("get_probe")!.Tool.Description);
        Assert.Equal("GET /host/beta/two", _catalog.Find("beta_custom")!.Tool.Description);
    }

    [Fact]
    public void C9_BodyPropertyNames_FollowSerializerPolicy()
    {
        JsonObject properties = (JsonObject)_catalog.Find("alpha_three")!.Tool.InputSchema["properties"]!;
        Assert.Equal(["firstName", "x_code"], properties.Select(p => p.Key).Order(StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public void C10_ReservedPrefix_NeverEntersCatalog()
    {
        Assert.Null(_catalog.Find("get_mcp_inside"));
        Assert.DoesNotContain(_catalog.Result.Entries, e => e.Descriptor.Route.StartsWith("/mcp", StringComparison.Ordinal));
    }

    [Fact]
    public async Task C14_OnCollisionMode_EmitsTheClaimedName()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(CatalogHostTests).Assembly);
        builder.Services.AddSkMcp(options => options.Naming.PrefixMode = PrefixMode.OnCollision);

        await using WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.MapControllers();
        app.MapSkMcp("/mcp");
        await app.StartAsync();

        SkMcpCatalogProvider catalog = app.Services.GetRequiredService<SkMcpCatalogProvider>();
        CatalogEntry entry = Assert.Single(
            catalog.Result.Entries,
            candidate => candidate.Descriptor.Route.Contains("/host/gamma", StringComparison.Ordinal));

        Assert.Equal("list", entry.Tool.Name);
        Assert.NotNull(catalog.Find("list"));
    }
}
