using System.Text.Json;
using System.Text.Json.Nodes;
using Liaiso.AspNetCore;
using Liaiso.AspNetCore.Discovery;
using Liaiso.AspNetCore.Requests;
using Liaiso.AspNetCore.Spec;

namespace Liaiso.Tests;

/// <remarks>
/// The twin of "query grouping" in sdks/nestjs/test/query-grouping.spec.ts, one layer lower: the
/// NestJS SDK flattens the DTO itself, while here ApiExplorer already did and the grouping pass
/// puts it back together.
/// </remarks>
public sealed class QueryObjectGroupingHostTests
{
    private static async Task<EndpointDescriptor> DescriptorAsync(
        string route, QueryObjectGrouping grouping)
    {
        await using SchemaHost host = await SchemaHost.StartAsync(
            configure: options => options.Query.Grouping = grouping);
        return host.Catalog.Result.Entries
            .Single(entry => entry.Descriptor.Route == route)
            .Descriptor;
    }

    [Fact]
    public async Task D1_FlattenLeavesEveryLeafATopLevelParameter()
    {
        EndpointDescriptor descriptor =
            await DescriptorAsync("/probe/filters", QueryObjectGrouping.Flatten);
        Assert.Equal(
            ["Meta", "Range.Max", "Range.Min", "Status", "Tags", "Threshold", "q"],
            descriptor.Parameters!.Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.All(descriptor.Parameters!, p => Assert.Null(p.Style));
    }

    [Fact]
    public async Task D2_GroupFoldsTheDtoIntoOneDottedDeepObjectAndLeavesTheSiblingScalar()
    {
        EndpointDescriptor descriptor =
            await DescriptorAsync("/probe/filters", QueryObjectGrouping.Group);
        Assert.Equal(
            ["filter", "q"],
            descriptor.Parameters!.Select(p => p.Name).Order(StringComparer.Ordinal));

        Parameter group = descriptor.Parameters!.Single(p => p.Name == "filter");
        Assert.Equal("deepObject", group.Style);
        Assert.Equal("dot", group.ObjectNotation);
        Assert.Equal("query", group.In);
        Assert.Equal(
            ["Status", "Tags", "Threshold"],
            ((JsonObject)group.Schema["properties"]!).Select(m => m.Key));
        Assert.False(group.Schema["additionalProperties"]!.GetValue<bool>());
    }

    /// <remarks>
    /// Guard: a nested or dictionary member must not reappear as a top-level parameter. Sending
    /// <c>?Range.Min=1</c> alongside <c>?filter.Status=a</c> makes ASP.NET's binder see the
    /// <c>filter</c> prefix, which closes the empty-prefix fallback, so <c>Range.Min</c> would
    /// never be read — worse than not grouping at all.
    /// </remarks>
    [Fact]
    public async Task D3_EveryLeafOfAGroupedParameterIsConsumed()
    {
        EndpointDescriptor descriptor =
            await DescriptorAsync("/probe/filters", QueryObjectGrouping.Group);
        Assert.DoesNotContain(descriptor.Parameters!, p => p.Name.Contains('.', StringComparison.Ordinal));
        Assert.DoesNotContain(descriptor.Parameters!, p => p.Name == "Meta");
    }

    [Fact]
    public async Task D4_TheDroppedMembersAreNamedInADiagnostic()
    {
        await using SchemaHost host = await SchemaHost.StartAsync(
            configure: options => options.Query.Grouping = QueryObjectGrouping.Group);
        CatalogDiagnostic note = host.Catalog.Result.Diagnostics.First(d =>
            d.Code == DiagnosticCodes.UnboundQueryObject
            && d.Message.Contains("/probe/filters", StringComparison.Ordinal));
        foreach (string dropped in new[] { "Meta", "Range.Max", "Range.Min" })
        {
            Assert.Contains(dropped, note.Message, StringComparison.Ordinal);
        }
    }

    /// <remarks>
    /// The pre-existing bug this feature closes: ApiExplorer reports the leaf as <c>Status</c>
    /// while the binder reads <c>f.Status</c>, so the flattened tool composes a key the backend
    /// never looks up and the DTO binds empty, silently.
    /// </remarks>
    [Fact]
    public async Task D5_AnExplicitBinderNameBecomesTheGroupsWireName()
    {
        Assert.Contains(
            (await DescriptorAsync("/probe/aliased", QueryObjectGrouping.Flatten)).Parameters!,
            p => p.Name == "Status");

        Parameter group = (await DescriptorAsync("/probe/aliased", QueryObjectGrouping.Group))
            .Parameters!.Single();
        Assert.Equal("f", group.Name);
        Assert.Equal("dot", group.ObjectNotation);
    }

    /// <remarks>
    /// The group is appended after the leaves that were not consumed, so a grouped catalog's
    /// query order differs from a flattened one's. Both are deterministic, which is what the
    /// corpus pins; ApiExplorer's own leaf order is reflection order and is not contracted.
    /// </remarks>
    [Fact]
    public async Task D6_TheGroupComposesTheDottedFormTheBinderReads()
    {
        await using SchemaHost host = await SchemaHost.StartAsync(
            configure: options => options.Query.Grouping = QueryObjectGrouping.Group);
        CatalogEntry entry = host.Catalog.Result.Entries
            .Single(e => e.Descriptor.Route == "/probe/filters");
        ComposedRequest composed = RequestComposer.Compose(
            entry.Template!,
            JsonDocument.Parse(
                """{"filter":{"Status":"open","Tags":["a","b"]},"q":"x"}""").RootElement);
        Assert.Equal(
            "/probe/filters?q=x&filter.Status=open&filter.Tags=a&filter.Tags=b",
            composed.PathAndQuery);
    }
}
