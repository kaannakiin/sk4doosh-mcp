using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Liaiso.Tests;

public sealed class RangeFilter
{
    public int Min { get; set; }
    public int Max { get; set; }
}

public sealed class ProbeFilter
{
    public string? Status { get; set; }
    public int Threshold { get; set; }
    public List<string>? Tags { get; set; }
    public RangeFilter? Range { get; set; }
    public Dictionary<string, string>? Meta { get; set; }
}

[ApiController]
[Route("/probe")]
public sealed class QueryObjectProbeController : ControllerBase
{
    [HttpGet("filters")]
    public IActionResult Filters([FromQuery] ProbeFilter filter, [FromQuery] string? q) =>
        Ok(new { filter, q });

    [HttpGet("aliased")]
    public IActionResult Aliased([FromQuery(Name = "f")] ProbeFilter filter) => Ok(filter);
}

/// <remarks>
/// Pins what ApiExplorer hands the SDK for a whole-object query binding. The grouping pass reads
/// these exact facts, and none of them is contracted by ASP.NET: they are behaviour of the
/// installed shared framework, so a runtime upgrade that changed one would otherwise surface as a
/// wrong query string rather than a failing test.
/// </remarks>
public sealed class QueryObjectProbeTests : IAsyncLifetime
{
    private WebApplication _app = null!;
    private IReadOnlyList<ApiDescription> _descriptions = null!;

    public async Task InitializeAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(SchemaHost).Assembly);
        _app = builder.Build();
        _app.UseRouting();
        _app.MapControllers();
        await _app.StartAsync();

        _descriptions = [.. _app.Services
            .GetRequiredService<IApiDescriptionGroupCollectionProvider>()
            .ApiDescriptionGroups.Items
            .SelectMany(group => group.Items)];
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private ApiDescription Of(string route) =>
        _descriptions.Single(d => d.RelativePath == route);

    [Fact]
    public void P1_ApiExplorerFlattensTheDtoAndDoesNotPrefixAnActionParametersLeaves()
    {
        string[] names = [.. Of("probe/filters").ParameterDescriptions
            .Select(p => p.Name).Order(StringComparer.Ordinal)];
        Assert.Equal(
            ["Meta", "Range.Max", "Range.Min", "Status", "Tags", "Threshold", "q"],
            names);
    }

    [Fact]
    public void P2_EveryLeafOfOneActionParameterSharesItsParameterDescriptorByReference()
    {
        List<ApiParameterDescription> leaves = [.. Of("probe/filters").ParameterDescriptions];
        ParameterDescriptor owner = leaves.Single(p => p.Name == "Status").ParameterDescriptor;
        Assert.All(
            leaves.Where(p => p.Name != "q"),
            leaf => Assert.True(ReferenceEquals(owner, leaf.ParameterDescriptor)));
        Assert.False(ReferenceEquals(
            owner, leaves.Single(p => p.Name == "q").ParameterDescriptor));
    }

    [Fact]
    public void P3_ALeafFromANestedObjectCarriesItsContainerTypeNotTheActionParametersType()
    {
        List<ApiParameterDescription> leaves = [.. Of("probe/filters").ParameterDescriptions];
        Assert.Equal(
            typeof(ProbeFilter),
            leaves.Single(p => p.Name == "Status").ModelMetadata.ContainerType);
        Assert.Equal(
            typeof(RangeFilter),
            leaves.Single(p => p.Name == "Range.Min").ModelMetadata.ContainerType);
    }

    /// <remarks>
    /// The binder reads <c>f.Status</c> for this action, but ApiExplorer still reports the leaf as
    /// <c>Status</c> — which is why today's flattened emission composes a key the backend never
    /// looks up, and why the group's wire name must come off the descriptor rather than the leaf.
    /// </remarks>
    [Fact]
    public void P4_AnExplicitBinderNameLivesOnTheDescriptorAndNotOnTheLeafNames()
    {
        List<ApiParameterDescription> leaves = [.. Of("probe/aliased").ParameterDescriptions];
        Assert.Contains(leaves, p => p.Name == "Status");
        Assert.DoesNotContain(leaves, p => p.Name.StartsWith("f.", StringComparison.Ordinal));
        Assert.Equal(
            "f",
            leaves.Single(p => p.Name == "Status").ParameterDescriptor.BindingInfo?.BinderModelName);
    }
}

