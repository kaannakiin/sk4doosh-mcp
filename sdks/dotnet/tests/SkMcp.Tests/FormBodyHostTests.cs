using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Caching;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Errors;
using SkMcp.AspNetCore.Files;
using SkMcp.AspNetCore.Spec;
using SkMcp.AspNetCore.Tools;
using SkMcp.AspNetCore.Visibility;

namespace SkMcp.Tests;

/// <remarks>
/// Proves what the conformance corpus cannot: that the bytes the dispatcher writes are what
/// <c>Request.Form</c>, <c>IFormFile</c> and a <c>[FromForm]</c> DTO actually bind through the
/// captured pipeline. The controllers are nested for <see cref="FormBindingProbeTests"/>'s reason.
/// </remarks>
public sealed class FormBodyHostTests : IAsyncLifetime
{
    public sealed class Address
    {
        public string? City { get; set; }
    }

    public sealed class TicketForm
    {
        public string? Title { get; set; }
        public List<string>? Tags { get; set; }
        public Address? Address { get; set; }
        public IFormFile? Attachment { get; set; }
    }

    public sealed class Patch
    {
        public string? Status { get; set; }
    }

    [ApiController]
    [Route("/host-form")]
    public sealed class TicketsController : ControllerBase
    {
        [HttpPost("tickets")]
        [McpTool(Name = "open_ticket")]
        public IActionResult Open([FromForm] TicketForm ticket) => Ok(new
        {
            ticket.Title,
            ticket.Tags,
            City = ticket.Address?.City,
            File = ticket.Attachment?.FileName,
            Type = Request.ContentType?.Split(';')[0],
        });

        [HttpPatch("tickets")]
        [Consumes("application/merge-patch+json")]
        [McpTool(Name = "patch_ticket")]
        public IActionResult PatchTicket([FromBody] Patch patch) => Ok(new
        {
            patch.Status,
            Type = Request.ContentType,
        });
    }

    private sealed class NestedControllers(params Type[] controllers)
        : IApplicationFeatureProvider<ControllerFeature>
    {
        public void PopulateFeature(IEnumerable<ApplicationPart> parts, ControllerFeature feature)
        {
            foreach (TypeInfo controller in controllers.Select(type => type.GetTypeInfo()))
            {
                if (!feature.Controllers.Contains(controller))
                {
                    feature.Controllers.Add(controller);
                }
            }
        }
    }

    private sealed class MemoryResolver : ISkMcpFileResolver
    {
        public string RefDescription => "An attachment id returned by upload_attachment.";

        public List<FileResolveRequest> Seen { get; } = [];

        public async ValueTask<FileResolution> ResolveAsync(
            FileResolveRequest request, CancellationToken cancellationToken)
        {
            Seen.Add(request);
            return request.Ref switch
            {
                "att-1" => new FileResolution.Resolved("id,total\n1,10\n"u8.ToArray(), "rapor.csv", "text/csv"),
                "att-big" => new FileResolution.Resolved(new byte[100]),
                "att-denied" => new FileResolution.Refused(FileRefusal.Forbidden),
                "att-busy" => new FileResolution.Refused(FileRefusal.Unavailable),
                "att-hang" => await new TaskCompletionSource<FileResolution>().Task,
                _ => new FileResolution.Refused(FileRefusal.NotFound),
            };
        }
    }

    private readonly MemoryResolver _resolver = new();
    private WebApplication _app = null!;
    private SkMcpMetaTools _tools = null!;
    private SkMcpCatalogProvider _catalog = null!;
    private int _uploads;

    public async Task InitializeAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddAntiforgery();
        builder.Services.AddControllers().ConfigureApplicationPartManager(manager =>
            manager.FeatureProviders.Add(new NestedControllers(typeof(TicketsController))));
        builder.Services.AddSingleton<ISkMcpFileResolver>(_resolver);
        builder.Services.AddSkMcp(options =>
        {
            options.Invoke.MaxInlineFileBytes = 32;
            options.Invoke.MaxFileBytes = 64;
            options.Invoke.Timeout = TimeSpan.FromMilliseconds(300);
        });

        _app = builder.Build();
        _app.UseSkMcpCapture();
        _app.UseRouting();
        _app.UseAntiforgery();
        _app.MapControllers();
        _app.MapPost("/host-form/minimal", ([FromForm] string title, [FromForm] int priority, HttpRequest request) =>
                new { title, priority, type = request.ContentType })
            .DisableAntiforgery()
            .WithMetadata(new McpToolAttribute { Name = "minimal_form" });
        _app.MapPost("/host-form/upload", (IFormFile attachment, [FromForm] string title) =>
                {
                    Interlocked.Increment(ref _uploads);
                    using MemoryStream bytes = new();
                    attachment.CopyTo(bytes);
                    return new
                    {
                        title,
                        name = attachment.FileName,
                        type = attachment.ContentType,
                        length = attachment.Length,
                        hex = Convert.ToHexString(bytes.ToArray()),
                    };
                })
            .DisableAntiforgery()
            .WithMetadata(new McpToolAttribute { Name = "upload" });
        _app.MapPost("/host-form/guarded", ([FromForm] string title) => title)
            .WithMetadata(new McpToolAttribute { Name = "guarded_form" });
        _app.MapSkMcp("/mcp");
        await _app.StartAsync();

        _catalog = _app.Services.GetRequiredService<SkMcpCatalogProvider>();
        _tools = new SkMcpMetaTools(
            _catalog,
            _app.Services.GetRequiredService<SkMcpDispatcher>(),
            _app.Services.GetRequiredService<IInvokeResultMapper>(),
            _app.Services.GetRequiredService<CallerVisibilityProvider>(),
            _app.Services.GetRequiredService<ICallerScopeResolver>(),
            _app.Services.GetRequiredService<IOptions<SkMcpOptions>>(),
            new FixedContext(new DefaultHttpContext()),
            _app.Services.GetRequiredService<ILogger<SkMcpMetaTools>>());
    }

    public async Task DisposeAsync() => await _app.DisposeAsync();

    private async Task<(JsonElement Raw, bool IsError)> InvokeAsync(string name, object arguments)
    {
        CallToolResult result = await _tools.InvokeTool(
            name, JsonSerializer.SerializeToElement(arguments), CancellationToken.None);
        string text = ((TextContentBlock)result.Content[0]).Text;
        return (JsonDocument.Parse(text).RootElement.Clone(), result.IsError == true);
    }

    private static JsonElement BodyOf(JsonElement raw)
    {
        Assert.Equal(200, raw.GetProperty("status").GetInt32());
        return raw.GetProperty("body");
    }

    [Fact]
    public async Task H1_AMinimalApiFormBindsTheUrlEncodedBodyWithoutACharset()
    {
        (JsonElement raw, bool isError) = await InvokeAsync("minimal_form", new { title = "İzmir & co", priority = 3 });
        Assert.False(isError);
        JsonElement body = BodyOf(raw);
        Assert.Equal("İzmir & co", body.GetProperty("title").GetString());
        Assert.Equal(3, body.GetProperty("priority").GetInt32());
        Assert.Equal("application/x-www-form-urlencoded", body.GetProperty("type").GetString());
    }

    [Fact]
    public async Task H2_AnIFormFileBindsATextFileAndKeepsANonAsciiName()
    {
        (JsonElement raw, _) = await InvokeAsync(
            "upload", new { title = "t", attachment = new { text = "a,b\n1,2", name = "çizim ğ.csv" } });
        JsonElement body = BodyOf(raw);
        Assert.Equal("t", body.GetProperty("title").GetString());
        Assert.Equal("çizim ğ.csv", body.GetProperty("name").GetString());
        Assert.Equal("text/plain; charset=utf-8", body.GetProperty("type").GetString());
        Assert.Equal(7, body.GetProperty("length").GetInt64());
    }

    [Fact]
    public async Task H3_ABase64FileArrivesAsItsExactBytes()
    {
        (JsonElement raw, _) = await InvokeAsync(
            "upload", new { title = "t", attachment = new { base64 = "AAH+/w==" } });
        Assert.Equal("0001FEFF", BodyOf(raw).GetProperty("hex").GetString());
    }

    [Fact]
    public async Task H4_ARefIsResolvedInsideTheDispatchWithTheCallsContext()
    {
        int before = _resolver.Seen.Count;
        (JsonElement raw, _) = await InvokeAsync(
            "upload", new { title = "t", attachment = new { @ref = "att-1" } });
        JsonElement body = BodyOf(raw);
        Assert.Equal("rapor.csv", body.GetProperty("name").GetString());
        Assert.Equal("text/csv", body.GetProperty("type").GetString());
        FileResolveRequest request = _resolver.Seen[before];
        Assert.Equal("attachment", request.Field);
        Assert.Equal("/host-form/upload", request.Target.Route);
        Assert.Equal(64, request.MaxBytes);
    }

    [Fact]
    public async Task H5_AMissingAndAForbiddenRefAnswerWithOneMessage()
    {
        (JsonElement missing, bool missingIsError) = await InvokeAsync(
            "upload", new { title = "t", attachment = new { @ref = "att-nope" } });
        (JsonElement denied, _) = await InvokeAsync(
            "upload", new { title = "t", attachment = new { @ref = "att-denied" } });
        Assert.True(missingIsError);
        Assert.Equal("file_unresolved", missing.GetProperty("error").GetString());
        Assert.False(missing.GetProperty("retryable").GetBoolean());
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(missing.GetRawText()), JsonNode.Parse(denied.GetRawText())));
    }

    [Fact]
    public async Task H6_AnUnavailableResolverIsRetryable()
    {
        (JsonElement raw, _) = await InvokeAsync(
            "upload", new { title = "t", attachment = new { @ref = "att-busy" } });
        Assert.Equal("file_unresolved", raw.GetProperty("error").GetString());
        Assert.True(raw.GetProperty("retryable").GetBoolean());
    }

    [Fact]
    public async Task H7_AResolvedFileOverThePerFileLimitIsRefused()
    {
        (JsonElement raw, _) = await InvokeAsync(
            "upload", new { title = "t", attachment = new { @ref = "att-big" } });
        Assert.Equal("file_too_large", raw.GetProperty("error").GetString());
        Assert.Equal(
            "File argument 'attachment' is over the limit of 64 bytes and was not sent.",
            raw.GetProperty("message").GetString());
    }

    [Fact]
    public async Task H8_AResolverThatNeverAnswersIsBoundedByTheInvokeDeadline()
    {
        System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
        (JsonElement raw, _) = await InvokeAsync(
            "upload", new { title = "t", attachment = new { @ref = "att-hang" } });
        Assert.Equal("invoke_timeout", raw.GetProperty("error").GetString());
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task H9_InlineBase64OverTheBudgetIsRefusedBeforeAnythingIsDispatched()
    {
        int before = Volatile.Read(ref _uploads);
        (JsonElement raw, _) = await InvokeAsync(
            "upload", new { title = "t", attachment = new { base64 = Convert.ToBase64String(new byte[40]) } });
        Assert.Equal("file_too_large", raw.GetProperty("error").GetString());
        Assert.Contains("inline limit of 32 bytes", raw.GetProperty("message").GetString(), StringComparison.Ordinal);
        Assert.Contains("'ref'", raw.GetProperty("message").GetString(), StringComparison.Ordinal);
        Assert.Equal(before, Volatile.Read(ref _uploads));
    }

    [Fact]
    public async Task H10_AFromFormDtoBindsDottedMembersRepeatedKeysAndAFile()
    {
        (JsonElement raw, _) = await InvokeAsync("open_ticket", new
        {
            Title = "t",
            Tags = new[] { "x", "y" },
            Address = new { City = "İzmir" },
            Attachment = new { text = "a", name = "a.txt" },
        });
        JsonElement body = BodyOf(raw);
        Assert.Equal("t", body.GetProperty("title").GetString());
        Assert.Equal(["x", "y"], body.GetProperty("tags").EnumerateArray().Select(tag => tag.GetString()));
        Assert.Equal("İzmir", body.GetProperty("city").GetString());
        Assert.Equal("a.txt", body.GetProperty("file").GetString());
        Assert.Equal("multipart/form-data", body.GetProperty("type").GetString());
    }

    [Fact]
    public void H11_AFormEndpointThatRequiresAntiforgeryIsDroppedWithADiagnostic()
    {
        Assert.Contains(_catalog.Result.Diagnostics, diagnostic =>
            diagnostic.Code == DiagnosticCodes.FormAntiforgeryRequired
            && diagnostic.Message.Contains("/host-form/guarded", StringComparison.Ordinal));
        Assert.DoesNotContain(_catalog.Result.Entries, entry => entry.Tool.Name == "guarded_form");
    }

    [Fact]
    public async Task H12_ADeclaredJsonSuffixTypeIsSentWithItsOwnContentType()
    {
        (JsonElement raw, bool isError) = await InvokeAsync("patch_ticket", new { status = "closed" });
        Assert.False(isError);
        JsonElement body = BodyOf(raw);
        Assert.Equal("closed", body.GetProperty("status").GetString());
        Assert.Equal("application/merge-patch+json; charset=utf-8", body.GetProperty("type").GetString());
    }

    [Fact]
    public async Task H13_TheLoadedSchemaOffersRefWhenAResolverIsRegistered()
    {
        CallToolResult result = await _tools.LoadTool("upload", CancellationToken.None);
        JsonNode loaded = JsonNode.Parse(((TextContentBlock)result.Content[0]).Text)!;
        JsonObject attachment = loaded["inputSchema"]!["properties"]!["attachment"]!.AsObject();
        Assert.True(attachment["properties"]!.AsObject().ContainsKey("ref"));
        Assert.Equal(3, attachment["oneOf"]!.AsArray().Count);
    }
}
