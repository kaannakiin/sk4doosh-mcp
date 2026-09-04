using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Requests;

namespace SkMcp.Tests;

public class WiringGuardTests
{
    [Fact]
    public void MapSkMcp_WithoutCapture_ThrowsAtStartup()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp();

        WebApplication app = builder.Build();
        app.UseRouting();

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => app.MapSkMcp("/mcp"));
        Assert.Contains("UseSkMcpCapture", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CaptureAfterAuthorization_DoesNotBypassProtectedEndpoint()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp();
        builder.Services.AddAuthentication("test").AddScheme<AuthenticationSchemeOptions, DenyAllHandler>("test", null);
        builder.Services.AddAuthorizationBuilder().AddPolicy("deny", p => p.RequireAssertion(_ => false));

        WebApplication app = builder.Build();
        app.UseRouting();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseSkMcpCapture();
        app.MapGet("/admin", () => "secret").RequireAuthorization("deny");
        await app.StartAsync();

        try
        {
            SkMcpDispatcher dispatcher = app.Services.GetRequiredService<SkMcpDispatcher>();
            RequestTemplate template = RequestTemplate.Create(HttpMethod.Get, "/admin");
            DispatchResult result = await dispatcher.DispatchAsync(
                template, JsonSerializer.SerializeToElement(new { }), null, CancellationToken.None);

            Assert.NotEqual(StatusCodes.Status200OK, result.Status);
            Assert.DoesNotContain("secret", result.Body, StringComparison.Ordinal);
        }
        finally
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }

    [Fact]
    public async Task CatalogReload_IsReachableThroughPublicChangeSource()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp();

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.MapGet("/ping", () => "pong");
        app.MapSkMcp("/mcp");
        await app.StartAsync();

        try
        {
            ISkMcpCatalogChangeSource source = app.Services.GetRequiredService<ISkMcpCatalogChangeSource>();
            long before = source.Generation;
            await source.ReloadAsync(CancellationToken.None);

            Assert.True(source.Generation > before);
        }
        finally
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }
    }

    private sealed class DenyAllHandler(
        Microsoft.Extensions.Options.IOptionsMonitor<AuthenticationSchemeOptions> options,
        Microsoft.Extensions.Logging.ILoggerFactory logger,
        System.Text.Encodings.Web.UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
            Task.FromResult(AuthenticateResult.NoResult());
    }
}
