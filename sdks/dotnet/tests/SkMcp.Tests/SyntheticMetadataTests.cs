using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SkMcp.AspNetCore;

namespace SkMcp.Tests;

internal static class MetaHost
{
    public static async Task<TestApp> StartAsync(Action<SkMcpOptions>? configure = null)
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp(configure);

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.MapGet("/meta", (HttpContext ctx) => string.Join('|',
            ctx.Request.Scheme,
            ctx.Request.Host.Value,
            ctx.Request.Headers.Accept.ToString(),
            ctx.Request.Headers.UserAgent.ToString(),
            ctx.Request.Headers["traceparent"].ToString(),
            ctx.Request.Headers.AcceptEncoding.ToString(),
            ctx.TraceIdentifier));
        app.MapGet("/tenant", (HttpRequest r) =>
            r.Host.Host.StartsWith("tenant-a", StringComparison.OrdinalIgnoreCase) ? "A" : "other");
        await app.StartAsync();
        return new TestApp(app, app.GetTestClient(), app.Services.GetRequiredService<SkMcpDispatcher>());
    }

    public static HttpRequest Outer(Action<HttpRequest> configure)
    {
        DefaultHttpContext ctx = new();
        configure(ctx.Request);
        return ctx.Request;
    }
}

public class SyntheticMetadataTests
{
    private static Task<DispatchResult> Meta(TestApp app, HttpRequest? outer) =>
        app.Dispatcher.DispatchAsync(HttpMethod.Get, "/meta", outer, CancellationToken.None);

    [Fact]
    public async Task M1_HostAndScheme_ReflectedFromOuter()
    {
        await using TestApp app = await MetaHost.StartAsync();
        HttpRequest outer = MetaHost.Outer(r =>
        {
            r.Scheme = "https";
            r.Host = new HostString("tenant-a.example.com");
        });

        string[] parts = (await Meta(app, outer)).Body.Split('|');
        Assert.Equal("https", parts[0]);
        Assert.Equal("tenant-a.example.com", parts[1]);

        DispatchResult tenant = await app.Dispatcher.DispatchAsync(
            HttpMethod.Get, "/tenant", outer, CancellationToken.None);
        Assert.Equal("A", tenant.Body);
    }

    [Fact]
    public async Task M2_NoOuterRequest_Fallbacks()
    {
        await using TestApp app = await MetaHost.StartAsync();
        string[] parts = (await Meta(app, null)).Body.Split('|');
        Assert.Equal("http", parts[0]);
        Assert.Equal("localhost", parts[1]);
    }

    [Fact]
    public async Task M3_HostOverride_BeatsOuter()
    {
        await using TestApp app = await MetaHost.StartAsync(o => o.Synthetic.Host = "internal.api");
        HttpRequest outer = MetaHost.Outer(r => r.Host = new HostString("tenant-a.example.com"));

        string[] parts = (await Meta(app, outer)).Body.Split('|');
        Assert.Equal("internal.api", parts[1]);
    }

    [Fact]
    public async Task M4_AcceptDefault_AndOverride()
    {
        await using TestApp app = await MetaHost.StartAsync();
        Assert.Equal("application/json", (await Meta(app, null)).Body.Split('|')[2]);

        await using TestApp custom = await MetaHost.StartAsync(o => o.Synthetic.Accept = "application/xml");
        Assert.Equal("application/xml", (await Meta(custom, null)).Body.Split('|')[2]);
    }

    [Fact]
    public async Task M5_UserAgentDefault_AndOverride()
    {
        await using TestApp app = await MetaHost.StartAsync();
        Assert.StartsWith("sk-mcp/", (await Meta(app, null)).Body.Split('|')[3]);

        await using TestApp custom = await MetaHost.StartAsync(o => o.Synthetic.UserAgent = "acme-agent/2");
        Assert.Equal("acme-agent/2", (await Meta(custom, null)).Body.Split('|')[3]);
    }

    [Fact]
    public async Task M6_TraceCorrelation_AlwaysOn()
    {
        await using TestApp app = await MetaHost.StartAsync();
        HttpRequest outer = MetaHost.Outer(r =>
            r.Headers["traceparent"] = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
        outer.HttpContext.TraceIdentifier = "outer-trace-123";

        string[] parts = (await Meta(app, outer)).Body.Split('|');
        Assert.Equal("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01", parts[4]);
        Assert.Equal("outer-trace-123", parts[6]);
    }

    [Fact]
    public async Task M7_AcceptEncoding_NeverForwarded()
    {
        await using TestApp app = await MetaHost.StartAsync();
        HttpRequest outer = MetaHost.Outer(r => r.Headers.AcceptEncoding = "gzip, br");

        string[] parts = (await Meta(app, outer)).Body.Split('|');
        Assert.Equal("", parts[5]);
    }
}
