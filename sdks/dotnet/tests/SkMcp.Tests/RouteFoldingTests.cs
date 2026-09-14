using SkMcp.AspNetCore.Naming;
using SkMcp.AspNetCore.Search;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.Tests;

public sealed class RouteFoldingTests
{
    private static readonly Auth UnusedAuth =
        new() { Anonymous = Anonymity.Yes, Policies = [], Imperative = false };

    private static EndpointDescriptor Endpoint(string route) => new()
    {
        OperationId = "Logout",
        Container = "SystemSoft",
        Method = "POST",
        Route = route,
        Auth = UnusedAuth,
    };

    [Fact]
    public void F1_Deduplicate_KeepsTheShortestRouteAndReportsTheRest()
    {
        EndpointDescriptor[] endpoints =
        [
            Endpoint("/Rest/Auth/Logout"),
            Endpoint("/Rest/Logout"),
            Endpoint("/Rest/Api/Auth/Logout"),
        ];

        EndpointDescriptor? kept = null;
        IReadOnlyList<EndpointDescriptor> folded = [];
        IReadOnlyList<EndpointDescriptor> operations = ToolNameFactory.Deduplicate(
            endpoints,
            e => e,
            (keptEndpoint, foldedEndpoints) =>
            {
                kept = keptEndpoint;
                folded = foldedEndpoints;
            });

        Assert.Single(operations);
        Assert.Equal("/Rest/Logout", operations[0].Route);
        Assert.Equal("/Rest/Logout", kept?.Route);
        Assert.Equal(
            ["/Rest/Auth/Logout", "/Rest/Api/Auth/Logout"],
            folded.Select(e => e.Route));
    }

    [Fact]
    public void F2_Deduplicate_ReportsNothingForAnOperationBoundToOneRoute()
    {
        bool reported = false;
        IReadOnlyList<EndpointDescriptor> operations = ToolNameFactory.Deduplicate(
            [Endpoint("/Rest/Logout")],
            e => e,
            (_, _) => reported = true);

        Assert.Single(operations);
        Assert.False(reported);
    }

    [Fact]
    public void F3_ToolIndex_MatchesOnAFoldedRoute()
    {
        ToolIndex index = new(
        [
            new SearchDocument(
                "system_soft_logout", null, [], "/Rest/Logout", ["/Rest/Auth/Logout"]),
            new SearchDocument("report_status", null, [], "/Rest/Status/Report"),
        ]);

        Assert.Equal(["system_soft_logout"], index.Search("auth", 5));
    }
}
