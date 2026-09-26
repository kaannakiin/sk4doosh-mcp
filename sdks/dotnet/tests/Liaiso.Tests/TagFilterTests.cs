using Liaiso.AspNetCore.Search;

namespace Liaiso.Tests;

/// <remarks>
/// Guard: these two rules cannot be expressed as <c>search</c> fixtures without the fixture itself
/// asserting a negative that a runner ignoring <c>input.tags</c> would also satisfy, so they are
/// pinned here and by the paired cases in packages/core/test/search.spec.ts. Folding is what the
/// two SDKs historically diverged on; a trim would diverge again, because JavaScript's
/// <c>String.prototype.trim</c> strips U+FEFF and <c>string.Trim</c> does not.
/// </remarks>
public sealed class TagFilterTests
{
    private static ToolIndex Index() => new(
    [
        new SearchDocument("list_orders", null, ["dolasım"], "/v1/orders"),
        new SearchDocument("list_returns", null, [" orders "], "/v1/returns"),
    ]);

    [Fact]
    public void G1_DotlessIStaysDistinctFromI()
    {
        Assert.Empty(Index().Search("", 20, ["dolasim"]));
        Assert.Equal(["list_orders"], Index().Search("", 20, ["dolasım"]));
    }

    [Fact]
    public void G2_TagIsNotTrimmed()
    {
        Assert.Empty(Index().Search("", 20, ["orders"]));
        Assert.Equal(["list_returns"], Index().Search("", 20, [" orders "]));
    }
}
