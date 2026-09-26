using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Liaiso.AspNetCore;
using Liaiso.AspNetCore.Requests;

namespace Liaiso.Tests;

public class WiringGuardTests
{
    [Fact]
    public void MapLiaiso_WithoutCapture_ThrowsAtStartup()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddLiaiso();

        WebApplication app = builder.Build();
        app.UseRouting();

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => app.MapLiaiso("/mcp"));
        Assert.Contains("UseLiaisoCapture", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CaptureAfterAuthorization_DoesNotBypassProtectedEndpoint()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddLiaiso();
        builder.Services.AddAuthentication("test").AddScheme<AuthenticationSchemeOptions, DenyAllHandler>("test", null);
        builder.Services.AddAuthorizationBuilder().AddPolicy("deny", p => p.RequireAssertion(_ => false));

        WebApplication app = builder.Build();
        app.UseRouting();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseLiaisoCapture();
        app.MapGet("/admin", () => "secret").RequireAuthorization("deny");
        await app.StartAsync();

        try
        {
            LiaisoDispatcher dispatcher = app.Services.GetRequiredService<LiaisoDispatcher>();
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
        builder.Services.AddLiaiso();

        WebApplication app = builder.Build();
        app.UseLiaisoCapture();
        app.UseRouting();
        app.MapGet("/ping", () => "pong");
        app.MapLiaiso("/mcp");
        await app.StartAsync();

        try
        {
            ILiaisoCatalogChangeSource source = app.Services.GetRequiredService<ILiaisoCatalogChangeSource>();
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
