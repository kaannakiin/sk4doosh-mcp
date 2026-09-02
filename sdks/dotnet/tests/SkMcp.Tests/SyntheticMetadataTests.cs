using System.Net;
using System.Text;
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
            ctx.TraceIdentifier,
            ctx.Connection.RemoteIpAddress is { } ip ? $"{ip}:{ctx.Connection.RemotePort}" : "",
            ctx.IsSkMcpRequest() ? "synthetic" : "outer"));
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

internal static class TransformHost
{
    public static async Task<TestApp> StartAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp();

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.Use(async (context, next) =>
        {
            if (context.IsSkMcpRequest())
            {
                await next();
                return;
            }
            if (!HttpMethods.IsGet(context.Request.Method) && context.Request.Headers["x-encrypted"] != "true")
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("Payload must be encrypted");
                return;
            }

            Stream outbound = context.Response.Body;
            using MemoryStream buffer = new();
            context.Response.Body = buffer;
            await next();
            context.Response.Body = outbound;
            context.Response.Headers["x-encrypted"] = "true";
            byte[] encoded = Encoding.UTF8.GetBytes(Convert.ToBase64String(buffer.ToArray()));
            context.Response.ContentLength = encoded.Length;
            await outbound.WriteAsync(encoded);
        });
        app.UseRouting();
        app.MapMethods("/payload", ["GET", "POST"], () => Results.Text(
            SyntheticMetadataTests.Body, "application/json"));
        await app.StartAsync();
        return new TestApp(app, app.GetTestClient(), app.Services.GetRequiredService<SkMcpDispatcher>());
    }
}

public class SyntheticMetadataTests
{
    internal const string Body = "{\"ok\":true}";

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

    [Fact]
    public async Task M8_ConnectionInfo_ReflectedFromOuter_NeverInvented()
    {
        await using TestApp app = await MetaHost.StartAsync();
        HttpRequest outer = MetaHost.Outer(_ => { });
        outer.HttpContext.Connection.RemoteIpAddress = IPAddress.Parse("203.0.113.7");
        outer.HttpContext.Connection.RemotePort = 4711;

        Assert.Equal("203.0.113.7:4711", (await Meta(app, outer)).Body.Split('|')[7]);
        Assert.Equal("", (await Meta(app, null)).Body.Split('|')[7]);
    }

    [Fact]
    public async Task M9_SyntheticMarker_CannotBeSetByOuterRequest()
    {
        await using TestApp app = await MetaHost.StartAsync();
        Assert.Equal("synthetic", (await Meta(app, null)).Body.Split('|')[8]);

        using HttpRequestMessage spoof = new(HttpMethod.Get, "/meta");
        spoof.Headers.TryAddWithoutValidation("sk-mcp.synthetic", "true");
        spoof.Headers.TryAddWithoutValidation("User-Agent", "sk-mcp/9.9.9");
        HttpResponseMessage response = await app.Client.SendAsync(spoof);

        Assert.Equal("outer", (await response.Content.ReadAsStringAsync()).Split('|')[8]);
    }

    [Fact]
    public async Task M10_BrowserTransforms_BypassedForSyntheticRequests()
    {
        await using TestApp app = await TransformHost.StartAsync();

        HttpResponseMessage browserGet = await app.Client.GetAsync("/payload");
        Assert.Equal("true", browserGet.Headers.GetValues("x-encrypted").Single());
        Assert.Equal(
            Body,
            Encoding.UTF8.GetString(Convert.FromBase64String(await browserGet.Content.ReadAsStringAsync())));

        using StringContent plain = new(Body, Encoding.UTF8, "application/json");
        HttpResponseMessage browserPost = await app.Client.PostAsync("/payload", plain);
        Assert.Equal(HttpStatusCode.BadRequest, browserPost.StatusCode);

        DispatchResult agentGet = await app.Dispatcher.DispatchAsync(
            HttpMethod.Get, "/payload", null, CancellationToken.None);
        DispatchResult agentPost = await app.Dispatcher.DispatchAsync(
            HttpMethod.Post, "/payload", null, CancellationToken.None);

        Assert.Equal(Body, agentGet.Body);
        Assert.Equal(StatusCodes.Status200OK, agentPost.Status);
        Assert.Equal(Body, agentPost.Body);
    }
}
