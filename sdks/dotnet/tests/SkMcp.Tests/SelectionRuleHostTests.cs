using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Discovery;

namespace SkMcp.Tests;

/// <remarks>
/// The twin of "selection rules" in sdks/nestjs/test/selection-rules.spec.ts. Minimal-API
/// endpoints rather than controllers: this host selects by a global include, so a controller
/// declared in this assembly would be pulled in through <c>AddApplicationPart</c> and every other
/// host test would see these endpoints in its own catalog.
/// </remarks>
public sealed class SelectionRuleHostTests : IAsyncLifetime
{
    private WebApplication _app = null!;
    private SkMcpCatalogProvider _catalog = null!;

    public async Task InitializeAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp(options =>
        {
            options.Selection.Default = SelectionDefault.Include;
            options.Selection.Rules.Add(new SelectionRule(SelectionDefault.Exclude, Route: "/admin/**"));
            options.Selection.Rules.Add(new SelectionRule(SelectionDefault.Exclude, Method: "POST"));
        });

        _app = builder.Build();
        _app.UseSkMcpCapture();
        _app.UseRouting();
        _app.MapGet("/admin/users", () => "ok");
        _app.MapGet("/admin/health", () => "ok")
            .WithMetadata(new McpToolAttribute { Name = "admin_health" });
        _app.MapGet("/orders", () => "ok");
        _app.MapPost("/orders", () => "ok");
        _app.MapSkMcp("/mcp");
        await _app.StartAsync();

        _catalog = _app.Services.GetRequiredService<SkMcpCatalogProvider>();
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private string[] Targets() => _catalog.Result.Entries
        .Select(e => $"{e.Descriptor.Method} {e.Descriptor.Route}")
        .Order(StringComparer.Ordinal)
        .ToArray();

    [Fact]
    public void S1_RuleCarvesASubtreeOutOfAGlobalIncludeWithoutAnAttribute() =>
        Assert.DoesNotContain("GET /admin/users", Targets());

    /// <remarks>
    /// Guard: an operation marker is the only place a carve-out can be written, because equally
    /// specific rules that disagree are a build error rather than a silent winner.
    /// </remarks>
    [Fact]
    public void S2_RuleLosesToAnOperationMarkerInsideTheExcludedSubtree() =>
        Assert.Contains("GET /admin/health", Targets());

    [Fact]
    public void S3_RuleNarrowsByMethodAlone() =>
        Assert.Equal(["GET /admin/health", "GET /orders"], Targets());
}

/// <remarks>Its own host, because the contradiction is reported as a fatal diagnostic.</remarks>
public sealed class SelectionRuleConflictHostTests : IAsyncLifetime
{
    private WebApplication _app = null!;
    private SkMcpCatalogProvider _catalog = null!;

    public async Task InitializeAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp(options =>
        {
            options.Selection.Default = SelectionDefault.Include;
            options.Selection.Rules.Add(new SelectionRule(SelectionDefault.Exclude, Route: "/admin/**"));
            options.Selection.Rules.Add(new SelectionRule(SelectionDefault.Include, Route: "/admin/users"));
        });

        _app = builder.Build();
        _app.UseSkMcpCapture();
        _app.UseRouting();
        _app.MapGet("/admin/users", () => "ok");
        _app.MapSkMcp("/mcp");
        await _app.StartAsync();

        _catalog = _app.Services.GetRequiredService<SkMcpCatalogProvider>();
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    [Fact]
    public void S4_EquallySpecificRulesThatDisagreeAreReported() =>
        Assert.Contains(
            _catalog.Result.Diagnostics,
            d => d.Code == DiagnosticCodes.AmbiguousSelection);

    [Fact]
    public void S5_TheContradictionIsFatalSoTheCatalogRefusesToValidate()
    {
        SkMcpCatalogException ex = Assert.Throws<SkMcpCatalogException>(_catalog.EnsureValid);
        Assert.Contains("equal specificity disagree", ex.Message, StringComparison.Ordinal);
    }
}

public sealed class SelectionRuleValidationTests
{
    /// <remarks>
    /// Guard: omitting a field is the catch-all; a blank one matches nothing, so it would decide
    /// nothing and say so nowhere.
    /// </remarks>
    [Fact]
    public void S6_ABlankRuleFieldIsAConfigurationFailure()
    {
        SkMcpOptions options = new();
        options.Selection.Rules.Add(new SelectionRule(SelectionDefault.Exclude, Route: "  "));

        ValidateOptionsResult result = new SkMcpOptionsValidator().Validate(null, options);

        Assert.True(result.Failed);
        Assert.Contains(result.Failures!, f => f.Contains("must not be blank", StringComparison.Ordinal));
    }
}
