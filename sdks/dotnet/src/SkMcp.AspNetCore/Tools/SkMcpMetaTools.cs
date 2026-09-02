using System.ComponentModel;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Server;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Visibility;
using SkMcp.AspNetCore.Visibility.Probe;

namespace SkMcp.AspNetCore.Tools;

[McpServerToolType]
public sealed class SkMcpMetaTools(
    SkMcpCatalogProvider catalog,
    SkMcpDispatcher dispatcher,
    IVisibilityEvaluator visibility,
    IProbeEvaluator probe,
    IOptions<SkMcpOptions> options,
    IHttpContextAccessor httpContextAccessor)
{
    public const int DefaultLimit = 20;
    public const int MaxLimit = 50;
    public const int CardDescriptionBudget = 160;

    private static readonly JsonSerializerOptions Wire = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    [McpServerTool(Name = "search_tools", ReadOnly = true, Idempotent = true)]
    [Description("Search the backend's API operations by keyword. Returns compact cards: name, short description and a parameter summary. An empty query lists operations by name. Keep queries short: a query term matches operation text by prefix. Call load_tool for the full input schema before invoke_tool.")]
    public async Task<string> SearchTools(
        [Description("Keywords matched by prefix against operation names, descriptions, tags and routes. Empty lists everything.")]
        string query = "",
        [Description("Maximum number of results, 1-50.")]
        int limit = DefaultLimit,
        CancellationToken cancellationToken = default)
    {
        catalog.EnsureValid();
        Func<CatalogEntry, VisibilityDecision> decide = await DecideAsync(cancellationToken);
        int capped = Math.Clamp(limit, 1, MaxLimit);
        int everything = Math.Max(1, catalog.Result.Entries.Count);
        int probeBudget = options.Value.Visibility.Tier == VisibilityTier.Probe
            ? Math.Max(0, options.Value.Visibility.ProbeTopK)
            : 0;

        List<object> results = [];
        foreach (CatalogEntry entry in catalog.Search(query, everything))
        {
            VisibilityDecision decision = decide(entry);
            if (decision == VisibilityDecision.Unknown && probeBudget > 0 && probe.CanProbe(entry))
            {
                probeBudget -= 1;
                decision = await probe.ProbeAsync(entry, httpContextAccessor.HttpContext?.Request, cancellationToken);
            }
            if (!IsVisible(decision))
            {
                continue;
            }
            results.Add(Card(entry, decision));
            if (results.Count == capped)
            {
                break;
            }
        }
        int total = catalog.Result.Entries.Count(entry => IsVisible(decide(entry)));

        return JsonSerializer.Serialize(new { total, results }, Wire);
    }

    [McpServerTool(Name = "load_tool", ReadOnly = true, Idempotent = true)]
    [Description("Load the full definition of one operation: description, JSON input schema and behavior hints. Use the exact name returned by search_tools.")]
    public async Task<string> LoadTool(
        [Description("Operation name exactly as returned by search_tools.")]
        string name,
        CancellationToken cancellationToken = default)
    {
        catalog.EnsureValid();
        CatalogEntry? entry = catalog.Find(name);
        if (entry is null)
        {
            return UnknownTool(name);
        }
        VisibilityDecision decision = (await DecideAsync(cancellationToken))(entry);
        if (decision == VisibilityDecision.Unknown
            && options.Value.Visibility.Tier == VisibilityTier.Probe
            && options.Value.Visibility.ProbeTopK > 0
            && probe.CanProbe(entry))
        {
            decision = await probe.ProbeAsync(entry, httpContextAccessor.HttpContext?.Request, cancellationToken);
        }
        if (!IsVisible(decision))
        {
            return UnknownTool(name);
        }
        return JsonSerializer.Serialize(new
        {
            entry.Tool.Name,
            entry.Tool.Description,
            entry.Tool.InputSchema,
            entry.Tool.Annotations,
            AuthUncertain = Uncertain(decision),
        }, Wire);
    }

    [McpServerTool(Name = "invoke_tool")]
    [Description("Invoke one operation with a JSON object of arguments that matches its input schema from load_tool. The call runs through the backend's own request pipeline with the caller's identity; the result carries the HTTP status and response body.")]
    public async Task<string> InvokeTool(
        [Description("Operation name exactly as returned by search_tools.")]
        string name,
        [Description("Arguments as a JSON object whose keys are the input schema's properties.")]
        JsonElement arguments,
        CancellationToken cancellationToken)
    {
        catalog.EnsureValid();
        CatalogEntry? entry = catalog.Find(name);
        if (entry is null)
        {
            return UnknownTool(name);
        }
        if (entry.Template is null)
        {
            return Error("not_invocable", $"Operation '{name}' cannot be invoked through sk-mcp; see the catalog diagnostics.");
        }

        try
        {
            DispatchResult result = await dispatcher.DispatchAsync(
                entry.Template, arguments, httpContextAccessor.HttpContext?.Request, cancellationToken);
            return JsonSerializer.Serialize(new { result.Status, result.Body }, Wire);
        }
        catch (SkMcpArgumentException ex)
        {
            return Error(ex.Code, ex.Message);
        }
    }

    private async Task<Func<CatalogEntry, VisibilityDecision>> DecideAsync(CancellationToken cancellationToken)
    {
        HashSet<string> policyNames = catalog.Result.Entries
            .SelectMany(entry => entry.Descriptor.Auth.Policies)
            .ToHashSet(StringComparer.Ordinal);
        CallerFacts facts = await visibility.ResolveAsync(
            httpContextAccessor.HttpContext?.Request, policyNames, cancellationToken);
        return entry => VisibilityCombiner.Evaluate(entry.Descriptor.Auth, facts);
    }

    private bool IsVisible(VisibilityDecision decision) => decision switch
    {
        VisibilityDecision.Allow => true,
        VisibilityDecision.Unknown => options.Value.Visibility.OnUnknown == UnknownVisibility.Show,
        _ => false,
    };

    private static bool? Uncertain(VisibilityDecision decision) =>
        decision == VisibilityDecision.Unknown ? true : null;

    private static object Card(CatalogEntry entry, VisibilityDecision decision) => new
    {
        entry.Tool.Name,
        Description = Truncate(entry.Tool.Description),
        Parameters = Summarize(entry.Tool.InputSchema),
        AuthUncertain = Uncertain(decision),
    };

    private static string Truncate(string text)
    {
        if (text.Length <= CardDescriptionBudget)
        {
            return text;
        }
        int cut = text.LastIndexOf(' ', CardDescriptionBudget);
        return text[..(cut > CardDescriptionBudget / 2 ? cut : CardDescriptionBudget)] + "…";
    }

    private static string Summarize(JsonObject inputSchema)
    {
        HashSet<string> required = new(StringComparer.Ordinal);
        if (inputSchema["required"] is JsonArray names)
        {
            foreach (JsonNode? node in names)
            {
                if (node?.GetValue<string>() is { } requiredName)
                {
                    required.Add(requiredName);
                }
            }
        }

        StringBuilder summary = new();
        if (inputSchema["properties"] is JsonObject properties)
        {
            foreach ((string name, JsonNode? schema) in properties)
            {
                if (summary.Length > 0)
                {
                    summary.Append(", ");
                }
                string type = schema?["type"]?.GetValue<string>() ?? "any";
                summary.Append(name).Append(": ").Append(type);
                if (required.Contains(name))
                {
                    summary.Append(" (required)");
                }
            }
        }
        return summary.ToString();
    }

    private static string UnknownTool(string name) =>
        Error("unknown_tool", $"No operation named '{name}'. Use search_tools to find the exact name.");

    private static string Error(string code, string message) =>
        JsonSerializer.Serialize(new { error = code, message }, Wire);
}
