using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Requests;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.Tests;

internal sealed class SentinelFlag
{
    public bool Hit;
}

internal static class EchoHost
{
    public static async Task<(TestApp App, SentinelFlag Sentinel)> StartAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp();
        builder.Services.AddSingleton<SentinelFlag>();

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.MapGet("/admin", (SentinelFlag flag) =>
        {
            flag.Hit = true;
            return "admin";
        });
        app.MapGet("/files/{name}", (string name) => name);
        app.MapGet("/echo", (HttpRequest r) => r.QueryString.Value ?? "");
        app.MapGet("/qval", (HttpRequest r) => r.Query["q"].ToString());
        app.MapGet("/tags", (HttpRequest r) => string.Join(",", r.Query["tag"].ToArray()!));
        app.MapGet("/typed/{id:int}", (int id) => id.ToString(CultureInfo.InvariantCulture));
        app.MapPost("/note", async (HttpRequest r) =>
        {
            using StreamReader reader = new(r.Body);
            return $"{r.ContentType}|{await reader.ReadToEndAsync()}";
        });
        await app.StartAsync();
        return (new TestApp(app, app.GetTestClient(), app.Services.GetRequiredService<SkMcpDispatcher>()),
            app.Services.GetRequiredService<SentinelFlag>());
    }
}

public class ArgumentMappingTests
{
    private static JsonElement Args(object value) => JsonSerializer.SerializeToElement(value);

    private static RequestTemplate PathString(string route, string name) => RequestTemplate.Create(
        HttpMethod.Get, route, [new ParameterBinding(name, ParameterLocation.Path, ParameterKind.String)]);

    [Fact]
    public async Task A1_PathTraversal_EncodedAndContained()
    {
        RequestTemplate template = PathString("/files/{name}", "name");
        ComposedRequest composed = RequestComposer.Compose(template, Args(new { name = "5/../admin" }));
        Assert.Equal("/files/5%2F..%2Fadmin", composed.PathAndQuery);

        (TestApp app, SentinelFlag sentinel) = await EchoHost.StartAsync();
        await using TestApp cleanup = app;
        DispatchResult result = await app.Dispatcher.DispatchAsync(
            template, Args(new { name = "5/../admin" }), null, CancellationToken.None);

        Assert.False(sentinel.Hit);
        Assert.NotEqual("admin", result.Body);
    }

    [Fact]
    public async Task A2_QueryInjection_StaysSingleParameter()
    {
        RequestTemplate template = RequestTemplate.Create(
            HttpMethod.Get, "/qval",
            [new ParameterBinding("q", ParameterLocation.Query, ParameterKind.String)]);

        (TestApp app, _) = await EchoHost.StartAsync();
        await using TestApp cleanup = app;
        DispatchResult result = await app.Dispatcher.DispatchAsync(
            template, Args(new { q = "a&admin=true" }), null, CancellationToken.None);

        Assert.Equal(200, result.Status);
        Assert.Equal("a&admin=true", result.Body);
    }

    [Fact]
    public void A3_HeaderControlCharacters_Rejected()
    {
        RequestTemplate template = RequestTemplate.Create(
            HttpMethod.Get, "/echo",
            [new ParameterBinding("X-Data", ParameterLocation.Header, ParameterKind.String)]);

        SkMcpArgumentException ex = Assert.Throws<SkMcpArgumentException>(() =>
            RequestComposer.Compose(template, Args(new Dictionary<string, string> { ["X-Data"] = "x\r\nEvil: 1" })));
        Assert.Equal(SkMcpArgumentException.HeaderInjection, ex.Code);
    }

    [Fact]
    public async Task A4_PathTypeGate_PreventsOpaque404()
    {
        RequestTemplate template = RequestTemplate.Create(
            HttpMethod.Get, "/typed/{id}",
            [new ParameterBinding("id", ParameterLocation.Path, ParameterKind.Integer)]);

        SkMcpArgumentException ex = Assert.Throws<SkMcpArgumentException>(() =>
            RequestComposer.Compose(template, Args(new { id = "abc" })));
        Assert.Equal(SkMcpArgumentException.InvalidPathType, ex.Code);

        (TestApp app, _) = await EchoHost.StartAsync();
        await using TestApp cleanup = app;
        DispatchResult ok = await app.Dispatcher.DispatchAsync(
            template, Args(new { id = 5 }), null, CancellationToken.None);
        Assert.Equal(200, ok.Status);
        Assert.Equal("5", ok.Body);
    }

    [Fact]
    public void A5_UnknownArgument_ErrorListsAllowed()
    {
        RequestTemplate template = RequestTemplate.Create(
            HttpMethod.Get, "/orders/{id}",
            [new ParameterBinding("id", ParameterLocation.Path, ParameterKind.Integer)]);

        SkMcpArgumentException ex = Assert.Throws<SkMcpArgumentException>(() =>
            RequestComposer.Compose(template, Args(new { id = 5, idd = 6 })));
        Assert.Equal(SkMcpArgumentException.UnknownArgument, ex.Code);
        Assert.Contains("idd", ex.Message);
        Assert.Contains("id", ex.Message);
    }

    [Fact]
    public async Task A6_AbsentOmitted_NullRejected()
    {
        RequestTemplate template = RequestTemplate.Create(
            HttpMethod.Get, "/echo",
            [new ParameterBinding("q", ParameterLocation.Query, ParameterKind.String)]);

        (TestApp app, _) = await EchoHost.StartAsync();
        await using TestApp cleanup = app;
        DispatchResult absent = await app.Dispatcher.DispatchAsync(
            template, Args(new { }), null, CancellationToken.None);
        Assert.Equal("", absent.Body);

        SkMcpArgumentException ex = Assert.Throws<SkMcpArgumentException>(() =>
            RequestComposer.Compose(template, Args(new { q = (string?)null })));
        Assert.Equal(SkMcpArgumentException.NullNotAllowed, ex.Code);
    }

    [Fact]
    public async Task A7_ArrayQuery_RepeatKey()
    {
        RequestTemplate template = RequestTemplate.Create(
            HttpMethod.Get, "/tags",
            [new ParameterBinding("tag", ParameterLocation.Query, ParameterKind.String, IsArray: true)]);

        ComposedRequest composed = RequestComposer.Compose(template, Args(new { tag = new[] { "a", "b" } }));
        Assert.Equal("/tags?tag=a&tag=b", composed.PathAndQuery);

        (TestApp app, _) = await EchoHost.StartAsync();
        await using TestApp cleanup = app;
        DispatchResult result = await app.Dispatcher.DispatchAsync(
            template, Args(new { tag = new[] { "a", "b" } }), null, CancellationToken.None);
        Assert.Equal("a,b", result.Body);
    }

    [Fact]
    public void A8_NumberFormatting_InvariantUnderTurkishCulture()
    {
        CultureInfo original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
            RequestTemplate template = RequestTemplate.Create(
                HttpMethod.Get, "/products",
                [new ParameterBinding("price", ParameterLocation.Query, ParameterKind.Number)]);
            ComposedRequest composed = RequestComposer.Compose(template, Args(new { price = 1.5 }));
            Assert.Equal("/products?price=1.5", composed.PathAndQuery);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public async Task A9_BodyComposition_FlattenedProperties()
    {
        RequestTemplate template = RequestTemplate.Create(
            HttpMethod.Post, "/note",
            [new ParameterBinding("v", ParameterLocation.Query, ParameterKind.Integer)],
            bodyProperties: ["text", "count"]);

        (TestApp app, _) = await EchoHost.StartAsync();
        await using TestApp cleanup = app;
        DispatchResult result = await app.Dispatcher.DispatchAsync(
            template, Args(new { v = 1, text = "merhaba", count = 3 }), null, CancellationToken.None);

        Assert.Equal(200, result.Status);
        string[] parts = result.Body.Split('|', 2);
        Assert.StartsWith("application/json", parts[0]);
        Assert.True(JsonNode.DeepEquals(
            JsonNode.Parse(parts[1]),
            JsonNode.Parse("""{"text":"merhaba","count":3}""")));
    }

    [Fact]
    public void A10_TemplateCreationGuards()
    {
        Assert.Throws<SkMcpTemplateException>(() => RequestTemplate.Create(
            HttpMethod.Get, "/x", bodyProperties: ["a"]));

        Assert.Throws<SkMcpTemplateException>(() => RequestTemplate.Create(
            HttpMethod.Get, "/x",
            [new ParameterBinding("Authorization", ParameterLocation.Header, ParameterKind.String)]));

        Assert.Throws<SkMcpTemplateException>(() => RequestTemplate.Create(
            HttpMethod.Put, "/orders/{id}",
            [new ParameterBinding("id", ParameterLocation.Path, ParameterKind.Integer)],
            bodyProperties: ["id"]));

        Assert.Throws<SkMcpTemplateException>(() => RequestTemplate.Create(
            HttpMethod.Get, "/orders/{id}", []));
    }

    /// <remarks>
    /// The twin of "rejects an object binding outside query, or one that is filled" and its
    /// siblings in packages/core/test/request-template.spec.ts. These rejections happen before
    /// <c>Compose</c>, so the conformance corpus cannot express them the way it expresses an
    /// argument error.
    /// </remarks>
    [Fact]
    public void A13_ObjectBindingGuards()
    {
        static RequestTemplate Build(ParameterBinding parameter) =>
            RequestTemplate.Create(HttpMethod.Get, "/items", [parameter]);

        ObjectMember[] one = [new ObjectMember("status", ParameterKind.String)];

        Assert.Contains("only a non-array query parameter", Assert.Throws<SkMcpTemplateException>(
            () => Build(new ParameterBinding(
                "filter", ParameterLocation.Header, ParameterKind.String, Members: one))).Message,
            StringComparison.Ordinal);

        Assert.Contains("cannot be hidden or filled", Assert.Throws<SkMcpTemplateException>(
            () => Build(new ParameterBinding(
                "filter", ParameterLocation.Query, ParameterKind.String, Members: one,
                Fill: new ArgumentFill { Kind = ArgumentFillKind.Constant, Value = "x" }))).Message,
            StringComparison.Ordinal);

        Assert.Contains("declares no members", Assert.Throws<SkMcpTemplateException>(
            () => Build(new ParameterBinding(
                "filter", ParameterLocation.Query, ParameterKind.String, Members: []))).Message,
            StringComparison.Ordinal);

        Assert.Contains("two members named", Assert.Throws<SkMcpTemplateException>(
            () => Build(new ParameterBinding(
                "filter", ParameterLocation.Query, ParameterKind.String,
                Members: [.. one, new ObjectMember("status", ParameterKind.Integer)]))).Message,
            StringComparison.Ordinal);

        foreach (string name in new[] { "a.b", "a[b]", "0" })
        {
            SkMcpTemplateException structural = Assert.Throws<SkMcpTemplateException>(
                () => Build(new ParameterBinding(
                    "filter", ParameterLocation.Query, ParameterKind.String,
                    Members: [new ObjectMember(name, ParameterKind.String)])));
            Assert.Equal(SkMcpTemplateException.UnsupportedObjectNesting, structural.Code);
            Assert.Contains("reads as structure", structural.Message, StringComparison.Ordinal);
        }
    }

    /// <remarks>
    /// The twin of "maps each style to its delimiter" and its siblings in
    /// packages/core/test/request-template.spec.ts. Only the fixture runner reached
    /// <see cref="RequestTemplate.ArraySeparatorFor"/> on this side, so the style guard's own
    /// wording was pinned in one language and not the other.
    /// </remarks>
    [Fact]
    public void A11_ArraySeparatorGuards()
    {
        Assert.Equal(",", RequestTemplate.ArraySeparatorFor("form", false, "tag"));
        Assert.Equal(" ", RequestTemplate.ArraySeparatorFor("spaceDelimited", false, "tag"));
        Assert.Equal("|", RequestTemplate.ArraySeparatorFor("pipeDelimited", false, "tag"));

        Assert.Null(RequestTemplate.ArraySeparatorFor("form", null, "tag"));
        Assert.Null(RequestTemplate.ArraySeparatorFor(null, null, "tag"));
        Assert.Equal(" ", RequestTemplate.ArraySeparatorFor("spaceDelimited", null, "tag"));

        foreach (string style in new[] { "spaceDelimited", "pipeDelimited" })
        {
            SkMcpTemplateException exploded = Assert.Throws<SkMcpTemplateException>(
                () => RequestTemplate.ArraySeparatorFor(style, true, "tag"));
            Assert.Equal(SkMcpTemplateException.UnsupportedArrayStyle, exploded.Code);
            Assert.Contains("has no wire form", exploded.Message, StringComparison.Ordinal);
        }

        foreach (bool? explode in new bool?[] { null, true, false })
        {
            SkMcpTemplateException deep = Assert.Throws<SkMcpTemplateException>(
                () => RequestTemplate.ArraySeparatorFor("deepObject", explode, "tag"));
            Assert.Equal(SkMcpTemplateException.UnsupportedArrayStyle, deep.Code);
            Assert.Contains("has no array form", deep.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void A12_ConformanceFixtures_AllPass()
    {
        string dir = Path.Combine(AppContext.BaseDirectory, "Fixtures", "argument-mapping");
        string[] files = Directory.GetFiles(dir, "*.json");
        Assert.NotEmpty(files);

        // Guard: this runner reads fixtures as raw JSON rather than through the generated types,
        // so a reader that stopped projecting an object parameter's members would compose every
        // grouped fixture as a bare scalar, and one that defaulted every notation to bracket
        // would still pass all the bracket fixtures while emitting the wrong bytes for the dot
        // ones. Two flags, because a single one is satisfied by the bracket family alone.
        bool grouped = false;
        bool dotted = false;

        foreach (string file in files)
        {
            using JsonDocument doc = JsonDocument.Parse(File.ReadAllText(file));
            JsonElement root = doc.RootElement;
            Assert.Equal("argument-mapping", root.GetProperty("kind").GetString());
            RequestTemplate template = BuildTemplate(
                root.GetProperty("input").GetProperty("template"), ref grouped, ref dotted);
            JsonElement arguments = root.GetProperty("input").GetProperty("arguments");
            Dictionary<string, JsonElement>? deferred = null;
            if (root.GetProperty("input").TryGetProperty("deferred", out JsonElement deferredSpec))
            {
                deferred = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
                foreach (JsonProperty entry in deferredSpec.EnumerateObject())
                {
                    deferred[entry.Name] = entry.Value;
                }
            }
            JsonElement expected = root.GetProperty("expected");

            if (expected.TryGetProperty("error", out JsonElement error))
            {
                SkMcpArgumentException ex = Assert.Throws<SkMcpArgumentException>(
                    () => RequestComposer.Compose(template, arguments, deferred));
                Assert.Equal(error.GetString(), ex.Code);
            }
            else
            {
                ComposedRequest composed = RequestComposer.Compose(template, arguments, deferred);
                Assert.Equal(expected.GetProperty("pathAndQuery").GetString(), composed.PathAndQuery);
                if (expected.TryGetProperty("headers", out JsonElement headers))
                {
                    foreach (JsonProperty header in headers.EnumerateObject())
                    {
                        Assert.Equal(header.Value.GetString(), composed.Headers[header.Name]);
                    }
                }
                if (expected.TryGetProperty("bodyJson", out JsonElement bodyJson))
                {
                    Assert.NotNull(composed.Body);
                    Assert.True(JsonNode.DeepEquals(
                        JsonNode.Parse(bodyJson.GetRawText()),
                        JsonNode.Parse(composed.Body)));
                }
                else
                {
                    Assert.Null(composed.Body);
                }
            }
        }

        Assert.True(grouped, "no argument-mapping fixture carried an object parameter");
        Assert.True(dotted, "no argument-mapping fixture carried dot notation");
    }

    private static RequestTemplate BuildTemplate(
        JsonElement spec, ref bool grouped, ref bool dotted)
    {
        List<ParameterBinding> parameters = [];
        if (spec.TryGetProperty("parameters", out JsonElement parameterSpecs))
        {
            foreach (JsonElement p in parameterSpecs.EnumerateArray())
            {
                if (p.GetProperty("type").GetString() == "object")
                {
                    grouped = true;
                    string? notation = p.TryGetProperty("notation", out JsonElement n)
                        ? n.GetString()
                        : null;
                    dotted |= notation == "dot";
                    parameters.Add(new ParameterBinding(
                        p.GetProperty("name").GetString()!,
                        ParameterLocation.Query,
                        ParameterKind.String,
                        Argument: p.TryGetProperty("as", out JsonElement groupName)
                            ? groupName.GetString()
                            : null,
                        Members: [.. p.GetProperty("members").EnumerateArray().Select(m =>
                            new ObjectMember(
                                m.GetProperty("name").GetString()!,
                                KindOf(m.GetProperty("type").GetString()),
                                m.TryGetProperty("array", out JsonElement memberArray)
                                    && memberArray.GetBoolean()))],
                        Notation: notation == "dot" ? ObjectNotation.Dot : ObjectNotation.Bracket));
                    continue;
                }
                parameters.Add(new ParameterBinding(
                    p.GetProperty("name").GetString()!,
                    p.GetProperty("in").GetString() switch
                    {
                        "path" => ParameterLocation.Path,
                        "query" => ParameterLocation.Query,
                        _ => ParameterLocation.Header,
                    },
                    KindOf(p.GetProperty("type").GetString()),
                    p.TryGetProperty("array", out JsonElement array) && array.GetBoolean(),
                    p.TryGetProperty("array", out JsonElement isArr) && isArr.GetBoolean()
                        ? RequestTemplate.ArraySeparatorFor(
                            p.TryGetProperty("style", out JsonElement style) ? style.GetString() : null,
                            p.TryGetProperty("explode", out JsonElement explode) ? explode.GetBoolean() : null,
                            p.GetProperty("name").GetString()!)
                        : null,
                    p.TryGetProperty("as", out JsonElement agentName) ? agentName.GetString() : null,
                    p.TryGetProperty("fill", out JsonElement fill)
                        ? fill.Deserialize<ArgumentFill>(FixtureJson)
                        : null));
            }
        }

        string? bodyRoot = spec.TryGetProperty("bodyRoot", out JsonElement root)
            ? root.GetString()
            : null;
        string[]? bodyProperties = null;
        bool additional = false;
        Dictionary<string, string> bodyAliases = new(StringComparer.Ordinal);
        Dictionary<string, ArgumentFill> bodyFills = new(StringComparer.Ordinal);
        if (bodyRoot is null && spec.TryGetProperty("body", out JsonElement body))
        {
            bodyProperties = body.GetProperty("properties").EnumerateArray()
                .Select(x => x.GetString()!).ToArray();
            additional = body.TryGetProperty("additionalProperties", out JsonElement a) && a.GetBoolean();
            if (body.TryGetProperty("curation", out JsonElement curation))
            {
                foreach (JsonElement record in curation.EnumerateArray())
                {
                    string name = record.GetProperty("name").GetString()!;
                    if (record.TryGetProperty("as", out JsonElement agentName))
                    {
                        bodyAliases[agentName.GetString()!] = name;
                    }
                    if (record.TryGetProperty("fill", out JsonElement fill))
                    {
                        bodyFills[name] = fill.Deserialize<ArgumentFill>(FixtureJson)!;
                    }
                }
            }
        }

        return RequestTemplate.Create(
            new HttpMethod(spec.GetProperty("method").GetString()!),
            spec.GetProperty("route").GetString()!,
            parameters,
            bodyProperties,
            additional,
            bodyRoot,
            bodyAliases,
            bodyFills,
            spec.TryGetProperty("rootFill", out JsonElement rootFill)
                ? rootFill.Deserialize<ArgumentFill>(FixtureJson)
                : null);
    }

    private static ParameterKind KindOf(string? type) => type switch
    {
        "integer" => ParameterKind.Integer,
        "number" => ParameterKind.Number,
        "boolean" => ParameterKind.Boolean,
        _ => ParameterKind.String,
    };

    private static readonly JsonSerializerOptions FixtureJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };
}
