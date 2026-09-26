using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Liaiso.AspNetCore;
using Liaiso.AspNetCore.Discovery;

namespace Liaiso.Tests;

/// <remarks>
/// Minimal-API endpoints rather than controllers: a controller declared in this assembly is
/// discovered by every other host test through <c>AddApplicationPart</c>, and these endpoints leak
/// on purpose, which would add diagnostics to catalogs that assert they have none. Minimal
/// endpoints are mapped per host and stay local to this one.
/// </remarks>
public sealed class CurationLeakHostTests : IAsyncLifetime
{
    private WebApplication _app = null!;
    private LiaisoCatalogProvider _catalog = null!;

    public async Task InitializeAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddLiaiso(options =>
        {
            options.Arguments.Curate(
                new CurationTarget(Route: "/leak/in-tool-description"),
                curation => curation.Hide("tenantId", "acme"));
            options.Arguments.Curate(
                new CurationTarget(Route: "/leak/in-argument-description"),
                curation => curation
                    .Hide("tenantId", "acme")
                    .Describe("keyword", "Free text within the tenantId in scope."));
            options.Arguments.Curate(
                new CurationTarget(Route: "/leak/clean"),
                curation => curation
                    .Hide("tenantId", "acme")
                    .Describe("keyword", "Free text to match."));
        });

        _app = builder.Build();
        _app.UseLiaisoCapture();
        _app.UseRouting();
        _app.MapGet(
                "/leak/in-tool-description",
                ([FromQuery] string tenantId, [FromQuery] string? keyword) => tenantId + keyword)
            .WithMetadata(
                new McpToolAttribute(),
                new EndpointDescriptionAttribute("Filters records by tenantId and keyword."));
        _app.MapGet(
                "/leak/in-argument-description",
                ([FromQuery] string tenantId, [FromQuery] string? keyword) => tenantId + keyword)
            .WithMetadata(
                new McpToolAttribute(),
                new EndpointDescriptionAttribute("Filters records."));
        _app.MapGet(
                "/leak/clean",
                ([FromQuery] string tenantId, [FromQuery] string? keyword) => tenantId + keyword)
            .WithMetadata(
                new McpToolAttribute(),
                new EndpointDescriptionAttribute("Filters records."));
        _app.MapLiaiso("/mcp");
        await _app.StartAsync();

        _catalog = _app.Services.GetRequiredService<LiaisoCatalogProvider>();
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private string[] CodesFor(string routeSegment)
    {
        string name = _catalog.Result.Entries
            .Single(e => e.Descriptor.Route.EndsWith(routeSegment, StringComparison.Ordinal))
            .Tool.Name;
        return [.. _catalog.Result.Diagnostics
            .Where(d => d.Message.Contains($"'{name}'", StringComparison.Ordinal))
            .Select(d => d.Code)
            .Order(StringComparer.Ordinal)];
    }

    [Fact]
    public void F1_ToolDescriptionLeak_ReportsTheOriginalCode()
    {
        Assert.Equal([DiagnosticCodes.CurationLeaksName], CodesFor("in-tool-description"));
    }

    [Fact]
    public void F2_CuratedArgumentDescriptionLeak_ReportsItsOwnCode()
    {
        Assert.Equal(
            [DiagnosticCodes.CurationLeaksNameInArgument], CodesFor("in-argument-description"));
    }

    [Fact]
    public void F3_NoCuratedProseNamesACuratedArgument_IsSilent()
    {
        Assert.Empty(CodesFor("clean"));
    }

    [Fact]
    public void F4_TheLeakingToolIsReachableByTheWireNameTheAgentCannotSend()
    {
        string name = _catalog.Result.Entries
            .Single(e => e.Descriptor.Route.EndsWith("in-argument-description", StringComparison.Ordinal))
            .Tool.Name;

        Assert.Contains(name, _catalog.Search("tenantId", 20).Select(e => e.Tool.Name));
        Assert.Equal(
            ["keyword"],
            _catalog.Result.Entries
                .Single(e => e.Tool.Name == name)
                .Tool.InputSchema["properties"]!.AsObject().Select(p => p.Key));
    }
}
