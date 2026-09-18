using System.Text.Json.Nodes;
using SkMcp.AspNetCore.Requests;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.Tests;

public sealed class CuratedDescriptionsTests
{
    private static EndpointDescriptor Endpoint(IReadOnlyList<ArgumentCuration>? arguments) => new()
    {
        OperationId = "GetOrder",
        Method = "GET",
        Route = "/orders/{id}",
        Description = "Fetches one order.",
        Parameters =
        [
            new Parameter
            {
                Name = "id",
                In = "path",
                Required = true,
                Schema = new JsonObject
                {
                    ["type"] = "integer",
                    ["description"] = "Internal row id.",
                },
                Description = "Row id",
            },
            new Parameter
            {
                Name = "tenantId",
                In = "query",
                Required = true,
                Schema = new JsonObject
                {
                    ["type"] = "string",
                    ["description"] = "Owning tenant.",
                },
            },
        ],
        Arguments = arguments,
        Auth = new Auth { Anonymous = Anonymity.Yes, Policies = [], Imperative = false },
    };

    private static readonly IReadOnlyList<ArgumentCuration> Curated =
    [
        new ArgumentCuration { Name = "id", Description = "The order's public identifier." },
        new ArgumentCuration
        {
            Name = "tenantId",
            Hidden = new ArgumentFill { Kind = ArgumentFillKind.Deferred, Source = "tenant" },
        },
    ];

    [Fact]
    public void E1_ReturnsOnlyTheDescriptionsTheHostDeclaredWhileCurating()
    {
        Assert.Equal(
            ["The order's public identifier."],
            ResolvedCuration.CuratedDescriptions(Endpoint(Curated), null));
    }

    [Fact]
    public void E2_NeverReturnsADescriptionInheritedFromTheOperationsOwnTypes()
    {
        IReadOnlyList<string> returned =
            ResolvedCuration.CuratedDescriptions(Endpoint(Curated), null);

        Assert.DoesNotContain("Internal row id.", returned);
        Assert.DoesNotContain("Row id", returned);
        Assert.DoesNotContain("Owning tenant.", returned);
    }

    [Fact]
    public void E3_TakesTheVariantsRecordWholeSoAVariantDropsTheEndpointsDescription()
    {
        ToolVariant variant = new()
        {
            Name = "get_order_public",
            Description = "Fetches one order by its public identifier.",
            Arguments = [new ArgumentCuration { Name = "id", As = "order_id" }],
        };

        Assert.Empty(ResolvedCuration.CuratedDescriptions(Endpoint(Curated), variant));
    }

    [Fact]
    public void E4_ReturnsTheVariantsOwnDescriptionWhenItDeclaresOne()
    {
        ToolVariant variant = new()
        {
            Name = "get_order_public",
            Description = "Fetches one order by its public identifier.",
            Arguments = [new ArgumentCuration { Name = "id", Description = "Public order code." }],
        };

        Assert.Equal(
            ["Public order code."],
            ResolvedCuration.CuratedDescriptions(Endpoint(Curated), variant));
    }

    [Fact]
    public void E5_IsEmptyWhenNothingIsCurated()
    {
        Assert.Empty(ResolvedCuration.CuratedDescriptions(Endpoint(null), null));
    }
}
