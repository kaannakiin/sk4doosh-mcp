using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using SkMcp.AspNetCore.Discovery;

namespace SkMcp.Tests;

public sealed class MinimalJsonBodyHostTests : InvokeHost
{
    public sealed record Note(string Text, int Priority);

    protected override void Map(WebApplication app)
    {
        app.MapPost("/host-minimal/notes", (Note note) => note)
            .WithMetadata(new McpToolAttribute { Name = "add_note" });
        app.MapPost("/host-minimal/optional", (Note? note) => new { received = note is not null })
            .WithMetadata(new McpToolAttribute { Name = "maybe_note" });
    }

    [Fact]
    public async Task MJ1_ARequiredTypedBodyIsReadByAMinimalApi()
    {
        JsonElement body = await InvokeAsync("add_note", new { text = "İzmir", priority = 2 });
        Assert.Equal("İzmir", body.GetProperty("text").GetString());
        Assert.Equal(2, body.GetProperty("priority").GetInt32());
    }

    [Fact]
    public async Task MJ2_AnOptionalTypedBodyIsNotSilentlyDropped()
    {
        JsonElement body = await InvokeAsync("maybe_note", new { body = new { text = "x", priority = 1 } });
        Assert.True(body.GetProperty("received").GetBoolean());
    }
}
