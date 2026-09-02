using System.Text.Json;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Naming;
using SkMcp.AspNetCore.Spec;
using Xunit.Abstractions;

namespace SkMcp.Tests;

public sealed class NamingDryRunTests(ITestOutputHelper output)
{
    private static readonly Auth UnusedAuth =
        new() { Anonymous = Anonymity.Yes, Policies = [], Imperative = false };

    [Fact]
    public void C4_NamingDryRun_ReportsCollisionsAndInvalidNames()
    {
        string? path = Environment.GetEnvironmentVariable("SKMCP_DRYRUN");
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            output.WriteLine("SKMCP_DRYRUN not set; nothing to measure.");
            return;
        }

        using JsonDocument document = JsonDocument.Parse(File.ReadAllText(path));
        List<EndpointDescriptor> endpoints = [];
        foreach (JsonElement item in document.RootElement.EnumerateArray())
        {
            endpoints.Add(new EndpointDescriptor
            {
                OperationId = item.TryGetProperty("operationId", out JsonElement id) ? id.GetString() : null,
                Container = item.TryGetProperty("controller", out JsonElement owner) ? owner.GetString() : null,
                Method = item.GetProperty("method").GetString()!,
                Route = item.GetProperty("route").GetString()!,
                Auth = UnusedAuth,
            });
        }

        output.WriteLine($"endpoints: {endpoints.Count}");
        Report("operationId", endpoints);
        Report("route", [.. endpoints.Select(e => e with { OperationId = null })]);
    }

    private void Report(string strategy, IReadOnlyList<EndpointDescriptor> endpoints)
    {
        Dictionary<string, List<EndpointDescriptor>> byName = new(StringComparer.Ordinal);
        List<(EndpointDescriptor Endpoint, string Code)> invalid = [];
        List<int> lengths = [];

        IReadOnlyList<EndpointDescriptor> operations =
            ToolNameFactory.Deduplicate(endpoints, e => e);

        foreach (EndpointDescriptor endpoint in operations)
        {
            try
            {
                string name = ToolNameFactory.Create(endpoint);
                lengths.Add(name.Length);
                if (!byName.TryGetValue(name, out List<EndpointDescriptor>? owners))
                {
                    byName[name] = owners = [];
                }
                owners.Add(endpoint);
            }
            catch (SkMcpCatalogException ex)
            {
                invalid.Add((endpoint, ex.Code));
            }
        }

        var collisions = byName.Where(p => p.Value.Count > 1)
            .OrderByDescending(p => p.Value.Count)
            .ToList();

        output.WriteLine("");
        output.WriteLine($"--- strategy: {strategy} ---");
        output.WriteLine($"operations        : {operations.Count} (merged {endpoints.Count - operations.Count})");
        output.WriteLine($"unique names      : {byName.Count}");
        output.WriteLine($"long names (>64)  : {lengths.Count(l => l > ToolNameFactory.LongNameThreshold)}");
        output.WriteLine($"invalid names     : {invalid.Count}");
        output.WriteLine($"colliding names   : {collisions.Count}");
        output.WriteLine($"endpoints lost    : {invalid.Count + collisions.Sum(c => c.Value.Count - 1)}");
        if (lengths.Count > 0)
        {
            output.WriteLine($"name length max/avg: {lengths.Max()} / {lengths.Average():F1}");
        }

        foreach (var collision in collisions.Take(10))
        {
            output.WriteLine($"  collision '{collision.Key}' x{collision.Value.Count}");
            foreach (EndpointDescriptor owner in collision.Value.Take(4))
            {
                output.WriteLine($"    {owner.Method} {owner.Route}");
            }
        }
        foreach (var (endpoint, code) in invalid.Take(10))
        {
            output.WriteLine($"  {code}: {endpoint.Method} {endpoint.Route}");
        }
    }
}
