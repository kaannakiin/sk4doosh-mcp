using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Naming;
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
        foreach (JsonElement root in Fixtures("selection"))
        {
            Assert.Equal("selection", root.GetProperty("kind").GetString());
            JsonElement input = root.GetProperty("input");
            SelectionDefault defaultDecision = Enum.Parse<SelectionDefault>(
                input.GetProperty("default").GetString()!, ignoreCase: true);
            JsonElement operations = input.GetProperty("operations");
            JsonElement expected = root.GetProperty("expected");

            if (expected.TryGetProperty("error", out JsonElement error))
            {
                SkMcpCatalogException ex = Assert.Throws<SkMcpCatalogException>(
                    () => Select(defaultDecision, operations));
                Assert.Equal(error.GetString(), ex.Code);
            }
            else
            {
                string[] selected = expected.GetProperty("selected")
                    .EnumerateArray().Select(n => n.GetString()!).ToArray();
                Assert.Equal(selected, Select(defaultDecision, operations));
            }
        }
    }

    [Fact]
    public void C3_MetadataExtractionFixtures_AllPass()
    {
        foreach (JsonElement root in Fixtures("metadata-extraction"))
        {
            Assert.Equal("metadata-extraction", root.GetProperty("kind").GetString());
            EndpointDescriptor endpoint = root.GetProperty("input")
                .Deserialize<EndpointDescriptor>(Neutral)!;

            JsonNode produced = JsonSerializer.SerializeToNode(
                ToolDefinitionFactory.Create(endpoint), Neutral)!;
            JsonNode expected = JsonNode.Parse(root.GetProperty("expected").GetRawText())!;

            Assert.True(
                JsonNode.DeepEquals(expected, produced),
                $"{endpoint.Method} {endpoint.Route}\nexpected: {expected.ToJsonString()}\nproduced: {produced.ToJsonString()}");
        }
    }

    [Fact]
    public void C5_SearchFixtures_AllPass()
    {
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
                    tool.GetProperty("route").GetString()!));
            }
            int limit = input.TryGetProperty("limit", out JsonElement declared)
                ? declared.GetInt32()
                : SkMcpMetaTools.DefaultLimit;

            string[] expected = root.GetProperty("expected").GetProperty("names")
                .EnumerateArray().Select(n => n.GetString()!).ToArray();
            IReadOnlyList<string> produced = new ToolIndex(documents)
                .Search(input.GetProperty("query").GetString(), limit);

            Assert.Equal(expected, produced);
        }
    }

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

    private static string[] Select(SelectionDefault defaultDecision, JsonElement operations)
    {
        List<string> selected = [];
        foreach (JsonElement operation in operations.EnumerateArray())
        {
            string id = operation.GetProperty("id").GetString()!;
            if (SelectionResolver.IsSelected(
                    defaultDecision, Marker(operation, "container"), Marker(operation, "operation"), id))
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
}
