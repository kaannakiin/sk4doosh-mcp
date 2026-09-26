using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Liaiso.AspNetCore;
using Liaiso.AspNetCore.Discovery;

namespace Liaiso.Tests;

[ApiController]
[Route("/tags/declared")]
public sealed class TagsDeclaredController : ControllerBase
{
    [HttpGet("list")]
    [McpTool(Name = "declares_tags", Tags = new[] { "billing", "orders" })]
    public IActionResult List() => Ok();
}

[ApiController]
[Route("/tags/inherited")]
[McpTool(Tags = new[] { "billing" })]
public sealed class TagsContainerController : ControllerBase
{
    [HttpGet("list")]
    [McpTool(Name = "inherits_tags")]
    public IActionResult List() => Ok();
}

[ApiController]
[Route("/tags/undeclared")]
public sealed class TagsUndeclaredController : ControllerBase
{
    [HttpGet("list")]
    [McpTool(Name = "undeclared_tags")]
    public IActionResult List() => Ok();
}

/// <remarks>
/// The twin of "tag declaration" in sdks/nestjs/test/tag-declaration.spec.ts. It runs on its own
/// host because two of its cases report diagnostics, and <see cref="CatalogHostTests"/> asserts
/// that its catalog reports none.
/// </remarks>
public sealed class TagDeclarationHostTests : IAsyncLifetime
{
    private WebApplication _app = null!;
    private LiaisoCatalogProvider _catalog = null!;

    public async Task InitializeAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(TagDeclarationHostTests).Assembly);
        builder.Services.AddLiaiso(options => options.Tags = container =>
            container.EndsWith(nameof(TagsUndeclaredController), StringComparison.Ordinal)
                ? ["central"]
                : null);

        _app = builder.Build();
        _app.UseLiaisoCapture();
        _app.UseRouting();
        _app.MapControllers();
        // Guard: the two cases that report a diagnostic are minimal APIs, not controller actions.
        // MVC discovers controllers across the whole test assembly, so a controller declaring a
        // duplicate or empty tag would push its diagnostics into every other host in this project,
        // and CatalogHostTests asserts that its catalog reports none.
        _app.MapGet("/tags/duplicate", () => "ok")
            .WithMetadata(new McpToolAttribute { Name = "duplicate_tags", Tags = ["Orders", "orders"] });
        _app.MapGet("/tags/empty", () => "ok")
            .WithMetadata(new McpToolAttribute { Name = "empty_tag", Tags = ["", "orders"] });
        _app.MapLiaiso("/mcp");
        await _app.StartAsync();

        _catalog = _app.Services.GetRequiredService<LiaisoCatalogProvider>();
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private IReadOnlyList<string>? TagsOf(string name) => _catalog.Find(name)?.Descriptor.Tags;

    private string[] CodesFor(string fragment) => _catalog.Result.Diagnostics
        .Where(d => d.Message.Contains(fragment, StringComparison.Ordinal))
        .Select(d => d.Code)
        .Order(StringComparer.Ordinal)
        .ToArray();

    [Fact]
    public void G3_DeclaredTagsReplaceTheContainerDerivedTag()
    {
        Assert.Equal(["billing", "orders"], TagsOf("declares_tags"));
    }

    /// <remarks>
    /// Guard: the reader has to consult the class explicitly, because SelectionAttribute returns
    /// the method attribute alone whenever one exists. Without that, a bare [McpTool] naming only
    /// the tool would erase the container's tags here while NestJS, which merges marker options key
    /// by key, would keep them.
    /// </remarks>
    [Fact]
    public void G4_ContainerTagsSurviveAnOperationMarkerThatDeclaresNone()
    {
        Assert.Equal(["billing"], TagsOf("inherits_tags"));
    }

    [Fact]
    public void G5_TagFoldingOntoAnEarlierOneIsDroppedAndReported()
    {
        Assert.Equal(["Orders"], TagsOf("duplicate_tags"));
        Assert.Equal([DiagnosticCodes.DuplicateTag], CodesFor("'orders' and 'Orders'"));
    }

    /// <remarks>
    /// Guard: only a tag that folds to the empty string is dropped. Whitespace survives folding on
    /// purpose — recognising a blank tag would need a whitespace class the two SDKs do not share,
    /// the same reason a tag is never trimmed.
    /// </remarks>
    [Fact]
    public void G6_TagFoldingToNothingIsDroppedAndReported()
    {
        Assert.Equal(["orders"], TagsOf("empty_tag"));
        Assert.Equal([DiagnosticCodes.EmptyTag], CodesFor("empty once folded"));
    }

    [Fact]
    public void G7_HostRuleAppliesWhenNoDeclarationExists()
    {
        Assert.Equal(["central"], TagsOf("undeclared_tags"));
    }
}
