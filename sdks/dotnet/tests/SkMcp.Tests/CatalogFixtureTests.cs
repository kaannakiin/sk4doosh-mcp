using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Naming;
using SkMcp.AspNetCore.Requests;
using SkMcp.AspNetCore.Search;
using SkMcp.AspNetCore.Spec;
using SkMcp.AspNetCore.Tools;
using SkMcp.AspNetCore.Visibility;

namespace SkMcp.Tests;

public sealed class CatalogFixtureTests
{
    private static readonly JsonSerializerOptions Neutral = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private static readonly Auth UnusedAuth =
        new() { Anonymous = Anonymity.Yes, Policies = [], Imperative = false };

    private static IEnumerable<JsonElement> Fixtures(string kind)
    {
        string dir = Path.Combine(AppContext.BaseDirectory, "Fixtures", kind);
        string[] files = Directory.GetFiles(dir, "*.json");
        Assert.NotEmpty(files);
        foreach (string file in files)
        {
            yield return JsonDocument.Parse(File.ReadAllText(file)).RootElement;
        }
    }

    [Fact]
    public void C1_NamingFixtures_AllPass()
    {
        foreach (JsonElement root in Fixtures("naming"))
        {
            Assert.Equal("naming", root.GetProperty("kind").GetString());
            JsonElement namingInput = root.GetProperty("input");
            PrefixMode mode = namingInput.TryGetProperty("prefixMode", out JsonElement prefixMode)
                && prefixMode.GetString() == "onCollision"
                    ? PrefixMode.OnCollision
                    : PrefixMode.Always;
            Dictionary<string, string> hostPrefixes = new(StringComparer.Ordinal);
            if (namingInput.TryGetProperty("hostPrefixes", out JsonElement declaredPrefixes))
            {
                foreach (JsonProperty entry in declaredPrefixes.EnumerateObject())
                {
                    hostPrefixes[entry.Name] = entry.Value.GetString()!;
                }
            }

            List<EndpointDescriptor> endpoints = [];
            foreach (JsonElement endpoint in namingInput.GetProperty("endpoints").EnumerateArray())
            {
                string? container = endpoint.TryGetProperty("container", out JsonElement containerValue)
                    ? containerValue.GetString()
                    : null;
                string? declared = endpoint.TryGetProperty("containerPrefix", out JsonElement prefixValue)
                    ? prefixValue.GetString()
                    : container is not null && hostPrefixes.TryGetValue(container, out string? hosted)
                        ? hosted
                        : null;
                endpoints.Add(new EndpointDescriptor
                {
                    OperationId = endpoint.TryGetProperty("operationId", out JsonElement operationId)
                        ? operationId.GetString()
                        : null,
                    Container = container,
                    ContainerPrefix = declared,
                    ToolName = endpoint.TryGetProperty("toolName", out JsonElement toolName)
                        ? toolName.GetString()
                        : null,
                    Method = endpoint.GetProperty("method").GetString()!,
                    Route = endpoint.GetProperty("route").GetString()!,
                    Variants = endpoint.TryGetProperty("variants", out JsonElement variants)
                        ? variants.Deserialize<IReadOnlyList<ToolVariant>>(Neutral)
                        : null,
                    Auth = UnusedAuth,
                });
            }

            JsonElement expected = root.GetProperty("expected");
            if (expected.TryGetProperty("error", out JsonElement error))
            {
                SkMcpCatalogException ex = Assert.Throws<SkMcpCatalogException>(
                    () => ToolNameFactory.CreateAll(endpoints, mode));
                Assert.Equal(error.GetString(), ex.Code);
            }
            else
            {
                string[] names = expected.GetProperty("names")
                    .EnumerateArray().Select(n => n.GetString()!).ToArray();
                Assert.Equal(names, ToolNameFactory.CreateAll(endpoints, mode));
            }
        }
    }

    [Fact]
    public void C2_SelectionFixtures_AllPass()
    {
        // Guard: this runner reads fixtures as raw JSON rather than through the generated types,
        // so a reader that stopped projecting input.rules would silently score every rule fixture
        // against an empty rule list and most of them would still pass.
        bool ruled = false;

        foreach (JsonElement root in Fixtures("selection"))
        {
            Assert.Equal("selection", root.GetProperty("kind").GetString());
            JsonElement input = root.GetProperty("input");
            SelectionDefault defaultDecision = Enum.Parse<SelectionDefault>(
                input.GetProperty("default").GetString()!, ignoreCase: true);
            JsonElement operations = input.GetProperty("operations");
            JsonElement expected = root.GetProperty("expected");
            IReadOnlyList<SelectionRule>? rules = Rules(input);
            ruled |= rules is not null;

            if (expected.TryGetProperty("error", out JsonElement error))
            {
                SkMcpCatalogException ex = Assert.Throws<SkMcpCatalogException>(
                    () => Select(defaultDecision, operations, rules));
                Assert.Equal(error.GetString(), ex.Code);
            }
            else
            {
                string[] selected = expected.GetProperty("selected")
                    .EnumerateArray().Select(n => n.GetString()!).ToArray();
                Assert.Equal(selected, Select(defaultDecision, operations, rules));
            }
        }

        Assert.True(ruled, "no selection fixture carried rules");
    }

    [Fact]
    public void C3_MetadataExtractionFixtures_AllPass()
    {
        foreach (JsonElement root in Fixtures("metadata-extraction"))
        {
            Assert.Equal("metadata-extraction", root.GetProperty("kind").GetString());
            EndpointDescriptor endpoint = root.GetProperty("input")
                .Deserialize<EndpointDescriptor>(Neutral)!;
            JsonElement expectation = root.GetProperty("expected");
            CurationRelief? relief = ReliefOf(root, endpoint);
            string? refDescription = root.TryGetProperty("files", out JsonElement files)
                && files.TryGetProperty("refDescription", out JsonElement described)
                    ? described.GetString()
                    : null;

            if (expectation.TryGetProperty("error", out JsonElement error))
            {
                SkMcpTemplateException failure = Assert.Throws<SkMcpTemplateException>(
                    () => ToolsOf(endpoint, relief, refDescription));
                Assert.Equal(error.GetString(), failure.Code);
                continue;
            }

            if (expectation.TryGetProperty("tools", out JsonElement expectedTools))
            {
                JsonNode producedTools = JsonSerializer.SerializeToNode(ToolsOf(endpoint, relief, refDescription), Neutral)!;
                JsonNode expectedNode = JsonNode.Parse(expectedTools.GetRawText())!;
                Assert.True(
                    JsonNode.DeepEquals(expectedNode, producedTools),
                    $"{endpoint.Method} {endpoint.Route}\nexpected: {expectedNode.ToJsonString()}\nproduced: {producedTools.ToJsonString()}");
                continue;
            }

            JsonNode produced = JsonSerializer.SerializeToNode(
                ToolsOf(endpoint, relief, refDescription).Single(), Neutral)!;
            JsonNode expected = JsonNode.Parse(expectation.GetRawText())!;

            Assert.True(
                JsonNode.DeepEquals(expected, produced),
                $"{endpoint.Method} {endpoint.Route}\nexpected: {expected.ToJsonString()}\nproduced: {produced.ToJsonString()}");
        }
    }

    /// <remarks>
    /// Always builds the request template too, not only when the body is not JSON: a
    /// parameter-level rejection (an unsupported style, an invalid cookie name, an identity
    /// carrier collision) surfaces only when the template is built, and a definition alone would
    /// still publish a tool whose template can never be built.
    /// </remarks>
    private static IReadOnlyList<ToolDefinition> ToolsOf(
        EndpointDescriptor endpoint, CurationRelief? relief, string? refDescription = null) =>
        [.. ToolNameFactory.ExpandProductions([endpoint], e => e)
            .Select(production =>
            {
                ToolDefinition tool = ToolDefinitionFactory.Create(
                    production.Endpoint, null, production.Variant, relief, refDescription);
                List<CatalogDiagnostic> diagnostics = [];
                (_, string? failure) = EndpointCatalog.BuildTemplate(
                    production.Endpoint, diagnostics, production.Variant, relief, refDescription);
                if (failure is not null)
                {
                    throw new SkMcpTemplateException(failure, diagnostics[^1].Message);
                }
                return tool;
            })];

    private static CurationRelief? ReliefOf(JsonElement root, EndpointDescriptor endpoint)
    {
        if (!root.TryGetProperty("foldedRoutes", out JsonElement folded))
        {
            return null;
        }
        HashSet<string> names = new(
            folded.EnumerateArray()
                .SelectMany(route => Placeholders(route.GetString() ?? "")),
            StringComparer.Ordinal);
        names.ExceptWith(Placeholders(endpoint.Route));
        return new CurationRelief(names, _ => { });
    }

    private static IEnumerable<string> Placeholders(string route) =>
        Regex.Matches(route, @"\{([^}:?*]+)[^}]*\}").Select(match => match.Groups[1].Value);

    [Fact]
    public void C5_SearchFixtures_AllPass()
    {
        // Guard: the fixture corpus is not type-checked against fixture.schema.json on this side,
        // so a runner that stopped reading inputSchema would silently score every parameter
        // fixture against an index with no parameters, and one that stopped reading input.tags
        // would silently drop every tag filter, and one that stopped reading
        // input.tools[].groupedParameters would index no grouped member and still pass every
        // other search fixture. Most cases would fail, but nothing structural says so.
        bool projected = false;
        bool filtered = false;
        bool memberIndexed = false;
        foreach (JsonElement root in Fixtures("search"))
        {
            Assert.Equal("search", root.GetProperty("kind").GetString());
            JsonElement input = root.GetProperty("input");
            List<SearchDocument> documents = [];
            foreach (JsonElement tool in input.GetProperty("tools").EnumerateArray())
            {
                documents.Add(new SearchDocument(
                    tool.GetProperty("name").GetString()!,
                    tool.TryGetProperty("description", out JsonElement description) ? description.GetString() : null,
                    tool.TryGetProperty("tags", out JsonElement tags)
                        ? [.. tags.EnumerateArray().Select(t => t.GetString()!)]
                        : [],
                    tool.GetProperty("route").GetString()!,
                    tool.TryGetProperty("alternateRoutes", out JsonElement alternates)
                        ? [.. alternates.EnumerateArray().Select(a => a.GetString()!)]
                        : null,
                    tool.TryGetProperty("inputSchema", out JsonElement inputSchema)
                        ? SearchParameters.From(JsonObject.Create(inputSchema), Grouped(tool))
                        : null));
                projected |= tool.TryGetProperty("inputSchema", out _);
                memberIndexed |= Grouped(tool) is not null;
            }
            int limit = input.TryGetProperty("limit", out JsonElement declared)
                ? declared.GetInt32()
                : SkMcpMetaTools.DefaultLimit;
            IReadOnlyList<string>? tagFilter = input.TryGetProperty("tags", out JsonElement declaredTags)
                ? [.. declaredTags.EnumerateArray().Select(t => t.GetString()!)]
                : null;
            filtered |= tagFilter is not null;

            string[] expected = root.GetProperty("expected").GetProperty("names")
                .EnumerateArray().Select(n => n.GetString()!).ToArray();
            IReadOnlyList<string> produced = new ToolIndex(documents)
                .Search(input.GetProperty("query").GetString(), limit, tagFilter);

            Assert.Equal(expected, produced);
        }

        Assert.True(projected, "no search fixture carried an inputSchema");
        Assert.True(filtered, "no search fixture carried a tags filter");
        Assert.True(memberIndexed, "no search fixture carried groupedParameters");
    }

    private static IReadOnlySet<string>? Grouped(JsonElement tool) =>
        tool.TryGetProperty("groupedParameters", out JsonElement grouped)
            ? new HashSet<string>(
                grouped.EnumerateArray().Select(name => name.GetString()!),
                StringComparer.Ordinal)
            : null;

    [Fact]
    public void C11_VisibilityFixtures_AllPass()
    {
        foreach (JsonElement root in Fixtures("visibility"))
        {
            Assert.Equal("visibility", root.GetProperty("kind").GetString());
            JsonElement input = root.GetProperty("input");
            Auth auth = input.GetProperty("auth").Deserialize<Auth>(Neutral)!;
            JsonElement caller = input.GetProperty("caller");

            Dictionary<string, VisibilityDecision> policyResults = new(StringComparer.Ordinal);
            if (caller.TryGetProperty("policyResults", out JsonElement results))
            {
                foreach (JsonProperty result in results.EnumerateObject())
                {
                    policyResults[result.Name] = Enum.Parse<VisibilityDecision>(result.Value.GetString()!, ignoreCase: true);
                }
            }
            CallerFacts facts = new(
                Enum.Parse<CallerIdentity>(caller.GetProperty("identity").GetString()!, ignoreCase: true),
                policyResults);

            string expected = root.GetProperty("expected").GetProperty("decision").GetString()!;
            Assert.Equal(expected, VisibilityCombiner.Evaluate(auth, facts).ToString().ToLowerInvariant());
        }
    }

    [Fact]
    public void C12_SchemaSimplificationFixtures_AllPass()
    {
        foreach (JsonElement root in Fixtures("schema-simplification"))
        {
            Assert.Equal("schema-simplification", root.GetProperty("kind").GetString());
            JsonElement input = root.GetProperty("input");
            TypeShape shape = input.GetProperty("shape").Deserialize<TypeShape>(Neutral)!;

            List<CatalogDiagnostic> diagnostics = [];
            SchemaWriterOptions options = new() { Report = diagnostics.Add };
            if (input.TryGetProperty("options", out JsonElement declared))
            {
                options = options with
                {
                    DropReadOnlyProperties =
                        !declared.TryGetProperty("dropReadOnlyProperties", out JsonElement drop)
                        || drop.GetBoolean(),
                    MaxDepth = declared.TryGetProperty("maxDepth", out JsonElement depth)
                        ? depth.GetInt32()
                        : null,
                };
            }

            JsonObject produced = new SchemaWriter(options).Write(shape);
            JsonElement expected = root.GetProperty("expected");
            JsonNode? want = JsonNode.Parse(expected.GetProperty("schema").GetRawText());
            Assert.True(
                JsonNode.DeepEquals(want, produced),
                $"expected {want?.ToJsonString()} but produced {produced.ToJsonString()}");

            string[] wantCodes = expected.TryGetProperty("diagnostics", out JsonElement codes)
                ? [.. codes.EnumerateArray().Select(c => c.GetString()!)]
                : [];
            Assert.Equal(wantCodes, diagnostics.Select(d => d.Code).ToArray());

            if (expected.TryGetProperty("defsOrder", out JsonElement order))
            {
                string[] wantOrder = [.. order.EnumerateArray().Select(c => c.GetString()!)];
                JsonObject defs = (JsonObject)produced["$defs"]!;
                Assert.Equal(wantOrder, defs.Select(p => p.Key).ToArray());
            }
        }
    }

    [Fact]
    public void C13_CardFixtures_AllPass()
    {
        foreach (JsonElement root in Fixtures("card"))
        {
            Assert.Equal("card", root.GetProperty("kind").GetString());
            JsonElement input = root.GetProperty("input");
            ToolDefinition tool = input.GetProperty("tool").Deserialize<ToolDefinition>(Neutral)!;
            VisibilityDecision decision =
                input.TryGetProperty("decision", out JsonElement declared)
                    ? Enum.Parse<VisibilityDecision>(declared.GetString()!, ignoreCase: true)
                    : VisibilityDecision.Allow;

            JsonNode produced = JsonSerializer.SerializeToNode(
                SkMcpMetaTools.CardFor(tool, decision), SkMcpJson.Wire)!;
            JsonNode? want = JsonNode.Parse(root.GetProperty("expected").GetRawText());
            Assert.True(
                JsonNode.DeepEquals(want, produced),
                $"expected {want?.ToJsonString()} but produced {produced.ToJsonString()}");
        }
    }

    [Fact]
    public void C14_DetailFixtures_AllPass()
    {
        foreach (JsonElement root in Fixtures("detail"))
        {
            Assert.Equal("detail", root.GetProperty("kind").GetString());
            JsonElement input = root.GetProperty("input");
            ToolDefinition tool = input.GetProperty("tool").Deserialize<ToolDefinition>(Neutral)!;
            VisibilityDecision decision =
                input.TryGetProperty("decision", out JsonElement declared)
                    ? Enum.Parse<VisibilityDecision>(declared.GetString()!, ignoreCase: true)
                    : VisibilityDecision.Allow;

            JsonNode produced = JsonSerializer.SerializeToNode(
                SkMcpMetaTools.DetailFor(tool, decision), SkMcpJson.Wire)!;
            JsonNode? want = JsonNode.Parse(root.GetProperty("expected").GetRawText());
            Assert.True(
                JsonNode.DeepEquals(want, produced),
                $"expected {want?.ToJsonString()} but produced {produced.ToJsonString()}");
        }
    }

    private static string[] Select(
        SelectionDefault defaultDecision,
        JsonElement operations,
        IReadOnlyList<SelectionRule>? rules)
    {
        List<string> selected = [];
        foreach (JsonElement operation in operations.EnumerateArray())
        {
            string id = operation.GetProperty("id").GetString()!;
            SelectionMarker? rule = SelectionResolver.ResolveRules(
                rules, Text(operation, "route") ?? string.Empty,
                Text(operation, "method") ?? string.Empty, id);
            if (SelectionResolver.IsSelected(
                    defaultDecision, Marker(operation, "container"), Marker(operation, "operation"), id, rule))
            {
                selected.Add(id);
            }
        }
        return [.. selected];
    }

    private static SelectionMarker? Marker(JsonElement operation, string level) =>
        operation.TryGetProperty(level, out JsonElement marker)
            ? Enum.Parse<SelectionMarker>(marker.GetString()!, ignoreCase: true)
            : null;

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value) ? value.GetString() : null;

    private static IReadOnlyList<SelectionRule>? Rules(JsonElement input) =>
        input.TryGetProperty("rules", out JsonElement rules)
            ? [.. rules.EnumerateArray().Select(rule => new SelectionRule(
                Enum.Parse<SelectionDefault>(rule.GetProperty("decision").GetString()!, ignoreCase: true),
                Text(rule, "route"),
                Text(rule, "method")))]
            : null;
}
