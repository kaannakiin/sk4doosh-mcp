using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Nodes;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Requests;
using SkMcp.AspNetCore.Discovery;

namespace SkMcp.Tests;

public sealed class SchemaHostTests : IAsyncLifetime
{
    private SchemaHost _host = null!;

    public async Task InitializeAsync() => _host = await SchemaHost.StartAsync();

    public async Task DisposeAsync() => await _host.DisposeAsync();

    [Fact]
    public void J15_DictionaryBody_IsInvocable()
    {
        CatalogEntry entry = _host.Entry("schema_bodies_map_body");

        JsonObject body = entry.Descriptor.RequestBody!.Schema;
        Assert.Equal("object", body["type"]!.GetValue<string>());
        Assert.Equal("string", body["additionalProperties"]!["type"]!.GetValue<string>());
        Assert.NotNull(entry.Template);
        Assert.True(entry.Template!.HasBody);

        ComposedRequest composed = RequestComposer.Compose(
            entry.Template,
            JsonSerializer.SerializeToElement(new Dictionary<string, string> { ["anything"] = "value" }));

        Assert.NotNull(composed.Body);
        Assert.Equal("{\"anything\":\"value\"}", System.Text.Encoding.UTF8.GetString(composed.Body!));
    }

    private JsonObject BodyProperty(SchemaHost host, string tool, string property) =>
        (JsonObject)((JsonObject)host.Entry(tool).Descriptor.RequestBody!.Schema["properties"]!)[property]!;

    [Fact]
    public void J11_EnumWireFormat_FollowsHostSerializer()
    {
        JsonObject state = BodyProperty(_host, "schema_bodies_map_enums", "state");
        Assert.Equal("integer", state["type"]!.GetValue<string>());
        Assert.Equal([0, 1, 2], state["enum"]!.AsArray().Select(v => v!.GetValue<int>()).ToArray());
    }

    [Fact]
    public async Task J12_EnumNames_FollowNamingPolicy()
    {
        await using SchemaHost stringHost = await SchemaHost.StartAsync(json =>
            json.JsonSerializerOptions.Converters.Add(
                new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

        JsonObject state = BodyProperty(stringHost, "schema_bodies_map_enums", "state");
        Assert.Equal("string", state["type"]!.GetValue<string>());
        Assert.Equal(
            ["active", "onHold", "closed"],
            state["enum"]!.AsArray().Select(v => v!.GetValue<string>()).ToArray());
    }

    [Fact]
    public void J13_FlagsEnum_OmitsEnumKeyword()
    {
        JsonObject flags = BodyProperty(_host, "schema_bodies_map_enums", "flags");
        Assert.Equal("integer", flags["type"]!.GetValue<string>());
        Assert.Null(flags["enum"]);
    }

    [Fact]
    public void J14_PropertyJsonConverter_OverridesHostFormat()
    {
        JsonObject forced = BodyProperty(_host, "schema_bodies_map_enums", "forced");
        Assert.Equal("string", forced["type"]!.GetValue<string>());
        Assert.Equal(
            ["Active", "OnHold", "Closed"],
            forced["enum"]!.AsArray().Select(v => v!.GetValue<string>()).ToArray());
    }

    [Fact]
    public void J20_RequiredFromRealDto_ReachesTheToolInputSchema()
    {
        JsonObject input = _host.Entry("schema_bodies_add_note").Tool.InputSchema;
        string[] required = input["required"]!.AsArray().Select(v => v!.GetValue<string>()).ToArray();
        Assert.Contains("text", required);
        Assert.Equal("text", required[^1]);

        JsonObject text = (JsonObject)((JsonObject)input["properties"]!)["text"]!;
        Assert.Equal("Not metni", text["description"]!.GetValue<string>());
    }

    [Fact]
    public void J16_ArgumentCollision_DropsEndpointAndReportsDiagnostic()
    {
        Assert.DoesNotContain(
            _host.Catalog.Result.Entries,
            entry => entry.Descriptor.Route.Contains("/schema/collide", StringComparison.Ordinal));
        Assert.Contains(
            _host.Catalog.Result.Diagnostics,
            d => d.Code == "argument_collision");
    }

    [Fact]
    public void J17_NonObjectBody_BecomesSyntheticBodyArgument()
    {
        CatalogEntry entry = Assert.Single(
            _host.Catalog.Result.Entries,
            candidate => candidate.Descriptor.Route.Contains("/schema/numbers", StringComparison.Ordinal));

        JsonObject properties = (JsonObject)entry.Tool.InputSchema["properties"]!;
        JsonObject body = (JsonObject)properties["body"]!;
        Assert.Equal("array", body["type"]!.GetValue<string>());
        Assert.Equal("integer", ((JsonObject)body["items"]!)["type"]!.GetValue<string>());
        Assert.Contains("body", entry.Tool.InputSchema["required"]!.AsArray()
            .Select(node => node!.GetValue<string>()));
        Assert.False(entry.Tool.InputSchema["additionalProperties"]!.GetValue<bool>());

        Assert.Contains(
            _host.Catalog.Result.Diagnostics,
            d => d.Code == "synthetic_body_argument");

        ComposedRequest composed = RequestComposer.Compose(
            entry.Template!,
            JsonDocument.Parse("""{"body":[1,2,3]}""").RootElement);
        Assert.Equal("[1,2,3]", Encoding.UTF8.GetString(composed.Body!));
    }

    [Fact]
    public void J18_OptionalBody_StopsFlatteningAndIsNotRequired()
    {
        CatalogEntry required = Assert.Single(
            _host.Catalog.Result.Entries,
            candidate => candidate.Descriptor.Route.EndsWith("/schema/notes/{id}", StringComparison.Ordinal));
        Assert.True(required.Descriptor.RequestBody!.Required);
        Assert.Contains("text", ((JsonObject)required.Tool.InputSchema["properties"]!).Select(p => p.Key));

        CatalogEntry optional = Assert.Single(
            _host.Catalog.Result.Entries,
            candidate => candidate.Descriptor.Route.EndsWith("/optional", StringComparison.Ordinal));
        Assert.False(optional.Descriptor.RequestBody!.Required);

        JsonObject properties = (JsonObject)optional.Tool.InputSchema["properties"]!;
        Assert.Contains("body", properties.Select(p => p.Key));
        Assert.DoesNotContain("text", properties.Select(p => p.Key));
        Assert.DoesNotContain("body", optional.Tool.InputSchema["required"]!.AsArray()
            .Select(node => node!.GetValue<string>()));
        Assert.Contains(
            _host.Catalog.Result.Diagnostics,
            d => d.Code == "optional_body_argument");

        ComposedRequest absent = RequestComposer.Compose(
            optional.Template!, JsonDocument.Parse("""{"id":7}""").RootElement);
        Assert.Null(absent.Body);

        ComposedRequest empty = RequestComposer.Compose(
            optional.Template!, JsonDocument.Parse("""{"id":7,"body":{}}""").RootElement);
        Assert.Equal("{}", Encoding.UTF8.GetString(empty.Body!));
    }

    [Fact]
    public void J20_ResponseSchema_KeepsReadOnlyMembersTheInputDrops()
    {
        CatalogEntry entry = _host.Entry("schema_bodies_audited");

        JsonObject input = (JsonObject)entry.Tool.InputSchema["properties"]!;
        Assert.Contains("first", input.Select(p => p.Key));
        Assert.Contains("last", input.Select(p => p.Key));
        Assert.DoesNotContain("fullName", input.Select(p => p.Key));

        JsonObject response = (JsonObject)entry.Descriptor.Responses!["200"].Schema!["properties"]!;
        Assert.Contains("fullName", response.Select(p => p.Key));
        Assert.Contains("first", response.Select(p => p.Key));
    }

    [Fact]
    public void J21_ResponseSchema_DoesNotRepeatTheRequestBodyDiagnostic()
    {
        Assert.Single(
            _host.Catalog.Result.Diagnostics,
            d => d.Code == "unsupported_dictionary_key"
                && d.Message.Contains("AuditKey", StringComparison.Ordinal));
    }

    [Fact]
    public async Task J19_DiagnosticsDowngrade_KeepsEndpointListed()
    {
        await using SchemaHost lenient = await SchemaHost.StartAsync(
            configure: options => options.Diagnostics.Downgrade.Add("argument_collision"));

        Assert.Contains(
            lenient.Catalog.Result.Entries,
            entry => entry.Descriptor.Route.Contains("/schema/collide", StringComparison.Ordinal));
    }
}
