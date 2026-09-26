using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Liaiso.AspNetCore;
using Liaiso.AspNetCore.Discovery;

namespace Liaiso.Tests;

public enum OrderState { Active, OnHold, Closed }

[Flags]
public enum OrderFlags { None = 0, Paid = 1, Shipped = 2 }

public sealed class EnumPayload
{
    public OrderState State { get; set; }
    public OrderFlags Flags { get; set; }
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public OrderState Forced { get; set; }
}

public sealed class CollidingPayload
{
    public int Id { get; set; }
    public string Label { get; set; } = string.Empty;
}

public sealed record NotePayload([Required][property: Description("Not metni")] string Text);

public sealed class AuditKey
{
    public int Value { get; set; }
}

public sealed class AuditedPayload
{
    public string First { get; set; } = string.Empty;
    public string Last { get; set; } = string.Empty;
    public string FullName => $"{First} {Last}";
    public Dictionary<AuditKey, string> Tags { get; set; } = [];
}

[ApiController]
[Route("/schema")]
public sealed class SchemaBodiesController : ControllerBase
{
    [HttpPost("map")]
    public IActionResult MapBody([FromBody] Dictionary<string, string> payload) => Ok(payload);

    [HttpPost("enums")]
    public IActionResult MapEnums([FromBody] EnumPayload payload) => Ok(payload);

    [HttpPost("collide/{id:int}")]
    public IActionResult Collide(int id, [FromBody] CollidingPayload payload) => Ok(new { id, payload });

    [HttpPost("numbers")]
    public IActionResult Numbers([FromBody] List<int> values) => Ok(values);

    [HttpPost("root-name/{body}")]
    public IActionResult RootName(string body, [FromBody] List<int> values) => Ok(new { body, values });

    [HttpPost("notes/{id:int}")]
    public IActionResult AddNote(int id, [FromQuery] bool notify, [FromBody] NotePayload payload) =>
        Ok(new { id, notify, payload });

    [HttpPost("notes/{id:int}/optional")]
    public IActionResult AddOptionalNote(int id, [FromBody] NotePayload? payload) =>
        Ok(new { id, payload });

    [HttpPut("audited")]
    [ProducesResponseType(typeof(AuditedPayload), StatusCodes.Status200OK)]
    public IActionResult Audited([FromBody] AuditedPayload payload) => Ok(payload);
}

public sealed class SchemaHost : IAsyncDisposable
{
    private readonly WebApplication _app;

    private SchemaHost(WebApplication app, LiaisoCatalogProvider catalog)
    {
        _app = app;
        Catalog = catalog;
    }

    internal LiaisoCatalogProvider Catalog { get; }

    public static async Task<SchemaHost> StartAsync(
        Action<Microsoft.AspNetCore.Mvc.JsonOptions>? json = null,
        Action<LiaisoOptions>? configure = null)
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        IMvcBuilder mvc = builder.Services.AddControllers()
            .AddApplicationPart(typeof(SchemaHost).Assembly);
        if (json is not null)
        {
            mvc.AddJsonOptions(json);
        }

        builder.Services.AddLiaiso(options =>
        {
            options.Selection.Default = SelectionDefault.Include;
            configure?.Invoke(options);
        });

        WebApplication app = builder.Build();
        app.UseLiaisoCapture();
        app.UseRouting();
        app.MapControllers();
        app.MapLiaiso("/mcp");
        await app.StartAsync();

        return new SchemaHost(app, app.Services.GetRequiredService<LiaisoCatalogProvider>());
    }

    public CatalogEntry Entry(string toolName) =>
        Catalog.Result.Entries.Single(entry => entry.Tool.Name == toolName);

    public async ValueTask DisposeAsync() => await _app.DisposeAsync();
}
