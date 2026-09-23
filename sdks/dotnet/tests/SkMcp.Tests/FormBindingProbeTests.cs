using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace SkMcp.Tests;

/// <remarks>
/// Pins what ASP.NET does with non-JSON request bodies: what ApiExplorer reports for form and file
/// bindings, which content types the pipeline accepts, and how the form binder names fields. None
/// of it is contracted by ASP.NET, so a runtime upgrade that changed one would otherwise surface as
/// a body the backend silently ignores. The controllers are nested so that the
/// <c>AddApplicationPart</c> scan every other host test runs never discovers them.
/// </remarks>
public sealed class FormBindingProbeTests : IAsyncLifetime
{
    public sealed class ProbeAddress
    {
        public string? City { get; set; }
        public string? Zip { get; set; }
    }

    public sealed class ProbeTicket
    {
        public string? Title { get; set; }
        public int Priority { get; set; }
        public List<string>? Tags { get; set; }
        public ProbeAddress? Address { get; set; }
        public IFormFile? Attachment { get; set; }
    }

    public sealed class ProbePatch
    {
        public string? Name { get; set; }
    }

    [ApiController]
    [Route("/probe-form")]
    public sealed class FormController : ControllerBase
    {
        [HttpPost("ticket")]
        public IActionResult Ticket([FromForm] ProbeTicket ticket) => Ok(new
        {
            ticket.Title,
            ticket.Priority,
            ticket.Tags,
            City = ticket.Address?.City,
            File = ticket.Attachment?.FileName,
            FileType = ticket.Attachment?.ContentType,
            FileLength = ticket.Attachment?.Length,
        });

        [HttpPost("upload")]
        public IActionResult Upload(IFormFile file, [FromForm] string? note) =>
            Ok(new { file.FileName, file.Length, note });

        [HttpPost("many")]
        public IActionResult Many(IFormFileCollection files) =>
            Ok(files.Select(f => f.FileName).ToArray());

        [HttpPatch("merge")]
        [Consumes("application/merge-patch+json")]
        public IActionResult Merge([FromBody] ProbePatch patch) => Ok(patch);

        [HttpPost("json")]
        public IActionResult Json([FromBody] ProbePatch patch) => Ok(patch);

        [HttpPost("text")]
        public IActionResult Text([FromBody] string value) => Ok(value);
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

    private WebApplication _app = null!;
    private HttpClient _client = null!;
    private IReadOnlyList<ApiDescription> _descriptions = null!;
    private IReadOnlyList<Endpoint> _endpoints = null!;

    public async Task InitializeAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddAntiforgery();
        builder.Services.AddControllers().ConfigureApplicationPartManager(manager =>
            manager.FeatureProviders.Add(new NestedControllers(typeof(FormController))));
        _app = builder.Build();
        _app.UseRouting();
        _app.UseAntiforgery();
        _app.MapControllers();
        _app.MapPost("/probe-minimal/guarded", ([FromForm] string title) => title);
        _app.MapPost("/probe-minimal/open", ([FromForm] string title) => title).DisableAntiforgery();
        _app.MapPost("/probe-minimal/file", (IFormFile file) => file.FileName).DisableAntiforgery();
        await _app.StartAsync();
        _client = _app.GetTestClient();

        _descriptions = [.. _app.Services
            .GetRequiredService<IApiDescriptionGroupCollectionProvider>()
            .ApiDescriptionGroups.Items
            .SelectMany(group => group.Items)];
        _endpoints = [.. _app.Services.GetRequiredService<EndpointDataSource>().Endpoints];
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    private ApiDescription Of(string route) =>
        _descriptions.Single(d => d.RelativePath == route);

    private Endpoint EndpointOf(string route) =>
        _endpoints.OfType<RouteEndpoint>().Single(e => e.RoutePattern.RawText?.TrimStart('/') == route);

    private static string[] FormatsOf(ApiDescription description) =>
        [.. description.SupportedRequestFormats.Select(f => f.MediaType)];

    private async Task<(HttpStatusCode Status, JsonElement Body)> SendAsync(HttpRequestMessage request)
    {
        using HttpResponseMessage response = await _client.SendAsync(request);
        string text = await response.Content.ReadAsStringAsync();
        JsonElement body = text.Length > 0 && text[0] is '{' or '[' or '"'
            ? JsonDocument.Parse(text).RootElement.Clone()
            : default;
        return (response.StatusCode, body);
    }

    [Fact]
    public void P1_ADefaultJsonBodyReportsTheThreeJsonFormatterTypesIncludingTheLiteralWildcard()
    {
        Assert.Equal(
            ["application/json", "text/json", "application/*+json"],
            FormatsOf(Of("probe-form/json")));
    }

    /// <remarks>
    /// ApiExplorer keeps a formatter type only when it is a subset of the declared one, and
    /// <c>application/*+json</c> is not a subset of <c>application/merge-patch+json</c>. The declared
    /// type therefore has to come off the endpoint's accepts metadata, never off this list.
    /// </remarks>
    [Fact]
    public void P2_ADeclaredJsonSuffixTypeIsMissingFromSupportedRequestFormatsButPresentAsAcceptsMetadata()
    {
        Assert.Empty(FormatsOf(Of("probe-form/merge")));
        IAcceptsMetadata accepts = EndpointOf("probe-form/merge").Metadata.GetOrderedMetadata<IAcceptsMetadata>()[^1];
        Assert.Equal(["application/merge-patch+json"], accepts.ContentTypes);
    }

    [Fact]
    public async Task P3_ADeclaredJsonSuffixTypeRefusesApplicationJsonWith415AndBindsItsOwnType()
    {
        const string payload = """{"name":"x"}""";
        (HttpStatusCode refused, _) = await SendAsync(new HttpRequestMessage(HttpMethod.Patch, "/probe-form/merge")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        });
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, refused);

        (HttpStatusCode accepted, JsonElement body) = await SendAsync(new HttpRequestMessage(HttpMethod.Patch, "/probe-form/merge")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/merge-patch+json"),
        });
        Assert.Equal(HttpStatusCode.OK, accepted);
        Assert.Equal("x", body.GetProperty("name").GetString());
    }

    [Fact]
    public void P4_AFromFormDtoIsFlattenedIntoDottedLeavesWithFileLeavesSourcedAsFormFile()
    {
        ApiDescription ticket = Of("probe-form/ticket");
        Dictionary<string, BindingSource?> leaves = ticket.ParameterDescriptions
            .ToDictionary(p => p.Name, p => p.Source);
        Assert.Equal(
            ["Address.City", "Address.Zip", "Attachment", "Priority", "Tags", "Title"],
            leaves.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(BindingSource.FormFile, leaves["Attachment"]);
        Assert.All(
            leaves.Where(l => l.Key != "Attachment"),
            leaf => Assert.Equal(BindingSource.Form, leaf.Value));
        ParameterDescriptor owner = ticket.ParameterDescriptions[0].ParameterDescriptor;
        Assert.All(ticket.ParameterDescriptions, leaf => Assert.Same(owner, leaf.ParameterDescriptor));
        Assert.Empty(FormatsOf(ticket));
    }

    [Fact]
    public void P5_ATopLevelFileParameterIsOneFormFileLeafAndDeclaresMultipart()
    {
        ApiDescription upload = Of("probe-form/upload");
        ApiParameterDescription file = upload.ParameterDescriptions.Single(p => p.Name == "file");
        Assert.Equal(BindingSource.FormFile, file.Source);
        Assert.Equal(typeof(IFormFile), file.Type);
        Assert.Equal(BindingSource.Form, upload.ParameterDescriptions.Single(p => p.Name == "note").Source);
        Assert.Equal(["multipart/form-data"], FormatsOf(upload));

        ApiParameterDescription files = Of("probe-form/many").ParameterDescriptions.Single();
        Assert.Equal(BindingSource.FormFile, files.Source);
        Assert.Equal(typeof(IFormFileCollection), files.Type);
    }

    private static ByteArrayContent UrlEncoded(string encoded, string contentType = "application/x-www-form-urlencoded")
    {
        ByteArrayContent content = new(Encoding.ASCII.GetBytes(encoded));
        content.Headers.ContentType = MediaTypeHeaderValue.Parse(contentType);
        return content;
    }

    [Fact]
    public async Task P6_UrlEncodedRepeatedKeysAndBothMemberNotationsBind()
    {
        (HttpStatusCode status, JsonElement body) = await SendAsync(new HttpRequestMessage(HttpMethod.Post, "/probe-form/ticket")
        {
            Content = UrlEncoded("Title=a%20b&Priority=3&Tags=x&Tags=y&Address.City=%C4%B0zmir"),
        });
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("a b", body.GetProperty("title").GetString());
        Assert.Equal(3, body.GetProperty("priority").GetInt32());
        Assert.Equal(["x", "y"], body.GetProperty("tags").EnumerateArray().Select(t => t.GetString()));
        Assert.Equal("İzmir", body.GetProperty("city").GetString());

        (_, JsonElement bracket) = await SendAsync(new HttpRequestMessage(HttpMethod.Post, "/probe-form/ticket")
        {
            Content = UrlEncoded("Address%5BCity%5D=Izmir"),
        });
        Assert.Equal("Izmir", bracket.GetProperty("city").GetString());
    }

    /// <remarks>
    /// The form reader decodes percent-escaped bytes with the charset on the Content-Type, so a
    /// urlencoded body labelled <c>us-ascii</c> — what <c>new StringContent(s, Encoding.ASCII, …)</c>
    /// writes — turns every non-ASCII character into <c>?</c>. The SDK writes the media type bare.
    /// </remarks>
    [Fact]
    public async Task P7_AUrlEncodedCharsetParameterDecidesHowEscapedBytesAreDecoded()
    {
        (_, JsonElement bare) = await SendAsync(new HttpRequestMessage(HttpMethod.Post, "/probe-form/ticket")
        {
            Content = UrlEncoded("Title=%C4%B0zmir"),
        });
        Assert.Equal("İzmir", bare.GetProperty("title").GetString());

        (_, JsonElement ascii) = await SendAsync(new HttpRequestMessage(HttpMethod.Post, "/probe-form/ticket")
        {
            Content = UrlEncoded("Title=%C4%B0zmir", "application/x-www-form-urlencoded; charset=us-ascii"),
        });
        Assert.Equal("??zmir", ascii.GetProperty("title").GetString());
    }

    [Fact]
    public async Task P8_AMultipartSectionIsAFileOnlyWhenItCarriesAFilenameAndANonAsciiNameRoundTrips()
    {
        using MultipartFormDataContent withName = new()
        {
            { new StringContent("t"), "Title" },
        };
        ByteArrayContent named = new([1, 2, 3]);
        named.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        withName.Add(named, "Attachment", "çizim ğ.png");
        (HttpStatusCode status, JsonElement body) = await SendAsync(new HttpRequestMessage(HttpMethod.Post, "/probe-form/ticket")
        {
            Content = withName,
        });
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal("çizim ğ.png", body.GetProperty("file").GetString());
        Assert.Equal("image/png", body.GetProperty("fileType").GetString());
        Assert.Equal(3, body.GetProperty("fileLength").GetInt64());

        using MultipartFormDataContent withoutName = new();
        ByteArrayContent anonymous = new([1, 2, 3]);
        anonymous.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        withoutName.Add(anonymous, "Attachment");
        (_, JsonElement unnamed) = await SendAsync(new HttpRequestMessage(HttpMethod.Post, "/probe-form/ticket")
        {
            Content = withoutName,
        });
        Assert.Equal(JsonValueKind.Null, unnamed.GetProperty("file").ValueKind);
    }

    [Fact]
    public async Task P9_AFromBodyStringRefusesTextPlainBecauseNoTextFormatterIsRegistered()
    {
        Assert.DoesNotContain("text/plain", FormatsOf(Of("probe-form/text")));
        (HttpStatusCode status, _) = await SendAsync(new HttpRequestMessage(HttpMethod.Post, "/probe-form/text")
        {
            Content = new StringContent("hello", Encoding.UTF8, "text/plain"),
        });
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, status);
    }

    [Fact]
    public async Task P10_AMinimalApiFormEndpointRequiresAntiforgeryUntilTheHostOptsOut()
    {
        IAntiforgeryMetadata guarded = EndpointOf("probe-minimal/guarded").Metadata.GetOrderedMetadata<IAntiforgeryMetadata>()[^1];
        Assert.True(guarded.RequiresValidation);
        IAntiforgeryMetadata open = EndpointOf("probe-minimal/open").Metadata.GetOrderedMetadata<IAntiforgeryMetadata>()[^1];
        Assert.False(open.RequiresValidation);

        (HttpStatusCode refused, _) = await SendAsync(new HttpRequestMessage(HttpMethod.Post, "/probe-minimal/guarded")
        {
            Content = new StringContent("title=a", Encoding.ASCII, "application/x-www-form-urlencoded"),
        });
        Assert.Equal(HttpStatusCode.BadRequest, refused);
        (HttpStatusCode accepted, _) = await SendAsync(new HttpRequestMessage(HttpMethod.Post, "/probe-minimal/open")
        {
            Content = new StringContent("title=a", Encoding.ASCII, "application/x-www-form-urlencoded"),
        });
        Assert.Equal(HttpStatusCode.OK, accepted);
    }

    [Fact]
    public void P11_AMinimalApiFormEndpointDeclaresItsFormTypesAsAcceptsMetadata()
    {
        Assert.Equal(
            ["multipart/form-data", "application/x-www-form-urlencoded"],
            EndpointOf("probe-minimal/open").Metadata.GetOrderedMetadata<IAcceptsMetadata>()[^1].ContentTypes);
        Assert.Equal(
            ["multipart/form-data"],
            EndpointOf("probe-minimal/file").Metadata.GetOrderedMetadata<IAcceptsMetadata>()[^1].ContentTypes);
    }
}
