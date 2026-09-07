using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using SkMcp.AspNetCore.Caching;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Errors;
using SkMcp.AspNetCore.Visibility;

namespace SkMcp.AspNetCore.Tools;

[McpServerToolType]
internal sealed class SkMcpMetaTools(
    SkMcpCatalogProvider catalog,
    SkMcpDispatcher dispatcher,
    IInvokeResultMapper mapper,
    CallerVisibilityProvider visibility,
    ICallerScopeResolver scopeResolver,
    IOptions<SkMcpOptions> options,
    IHttpContextAccessor httpContextAccessor)
{
    public const int DefaultLimit = 20;
    public const int MaxLimit = 50;
    public const int CardDescriptionBudget = 160;

    private sealed record DecisionContext(Func<CatalogEntry, VisibilityDecision> Decide, CallerScope Scope, HttpRequest? Outer);

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
        DecisionContext context = await DecideAsync(cancellationToken);
        int capped = Math.Clamp(limit, 1, MaxLimit);
        int everything = Math.Max(1, catalog.Result.Entries.Count);
        int probeBudget = options.Value.Visibility.Tier == VisibilityTier.Probe
            ? Math.Max(0, options.Value.Visibility.ProbeTopK)
            : 0;

        List<CatalogEntry> ranked = [.. catalog.Search(query, everything)];
        Dictionary<string, VisibilityDecision> decisions = new(StringComparer.Ordinal);
        List<CatalogEntry> probeQueue = [];
        foreach (CatalogEntry entry in ranked)
        {
            VisibilityDecision decision = context.Decide(entry);
            decisions[entry.Tool.Name] = decision;
            if (decision == VisibilityDecision.Unknown && probeBudget > 0 && visibility.CanProbe(entry))
            {
                probeBudget -= 1;
                probeQueue.Add(entry);
            }
        }

        if (probeQueue.Count > 0)
        {
            int concurrency = Math.Max(1, options.Value.Visibility.ProbeConcurrency);
            using SemaphoreSlim gate = new(concurrency);
            VisibilityDecision[] probed = new VisibilityDecision[probeQueue.Count];
            await Task.WhenAll(probeQueue.Select(async (entry, index) =>
            {
                await gate.WaitAsync(cancellationToken);
                try
                {
                    probed[index] = await visibility.ProbeAsync(context.Scope, context.Outer, entry, cancellationToken);
                }
                finally
                {
                    gate.Release();
                }
            }));
            for (int index = 0; index < probeQueue.Count; index++)
            {
                decisions[probeQueue[index].Tool.Name] = probed[index];
            }
        }

        List<object> results = [];
        foreach (CatalogEntry entry in ranked)
        {
            VisibilityDecision decision = decisions[entry.Tool.Name];
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
        int total = catalog.Result.Entries.Count(entry => IsVisible(context.Decide(entry)));

        return JsonSerializer.Serialize(new { total, results }, SkMcpJson.Wire);
    }

    [McpServerTool(Name = "load_tool", ReadOnly = true, Idempotent = true)]
    [Description("Load the full definition of one operation: description, JSON input schema and behavior hints. Use the exact name returned by search_tools.")]
    public async Task<CallToolResult> LoadTool(
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
        DecisionContext context = await DecideAsync(cancellationToken);
        VisibilityDecision decision = context.Decide(entry);
        if (decision == VisibilityDecision.Unknown
            && options.Value.Visibility.Tier == VisibilityTier.Probe
            && options.Value.Visibility.ProbeTopK > 0
            && visibility.CanProbe(entry))
        {
            decision = await visibility.ProbeAsync(context.Scope, context.Outer, entry, cancellationToken);
        }
        if (!IsVisible(decision))
        {
            return UnknownTool(name);
        }
        return TextResult(JsonSerializer.Serialize(new
        {
            entry.Tool.Name,
            entry.Tool.Description,
            entry.Tool.InputSchema,
            entry.Tool.Annotations,
            AuthUncertain = Uncertain(decision),
        }, SkMcpJson.Wire), isError: false);
    }

    [McpServerTool(Name = "invoke_tool")]
    [Description("Invoke one operation with a JSON object of arguments that matches its input schema from load_tool. The call runs through the backend's own request pipeline with the caller's identity; the result carries the HTTP status and response body.")]
    public async Task<CallToolResult> InvokeTool(
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
            return ErrorResult("not_invocable", $"Operation '{name}' cannot be invoked through sk-mcp; see the catalog diagnostics.");
        }

        try
        {
            DispatchResult result = await dispatcher.DispatchAsync(
                entry.Template, arguments, httpContextAccessor.HttpContext?.Request, cancellationToken);
            InvokeOutcome outcome = mapper.Map(result.ToBackendResponse(), KnownFields(entry));
            return outcome switch
            {
                InvokeSucceeded succeeded => TextResult(JsonSerializer.Serialize(succeeded.Success, SkMcpJson.Wire), isError: false),
                InvokeFailed failed => TextResult(JsonSerializer.Serialize(failed.Error, SkMcpJson.Wire), isError: true),
                _ => throw new InvalidOperationException($"Unhandled invoke outcome: {outcome.GetType()}"),
            };
        }
        catch (SkMcpArgumentException ex)
        {
            return ErrorResult(ex.Code, ex.Message);
        }
    }

    private async Task<DecisionContext> DecideAsync(CancellationToken cancellationToken)
    {
        HttpRequest? outer = httpContextAccessor.HttpContext?.Request;
        CallerScope scope = scopeResolver.Resolve(outer);
        CallerFacts facts = await visibility.FactsAsync(scope, outer, catalog.PolicyNames, cancellationToken);
        return new DecisionContext(entry => VisibilityCombiner.Evaluate(entry.Descriptor.Auth, facts), scope, outer);
    }

    private bool IsVisible(VisibilityDecision decision) => decision switch
    {
        VisibilityDecision.Allow => true,
        VisibilityDecision.Unknown => options.Value.Visibility.OnUnknown == UnknownVisibility.Show,
        _ => false,
    };

    private static bool? Uncertain(VisibilityDecision decision) =>
        decision == VisibilityDecision.Unknown ? true : null;

    private static object Card(CatalogEntry entry, VisibilityDecision decision) =>
        CardFor(entry.Tool, decision);

    internal static object CardFor(Spec.ToolDefinition tool, VisibilityDecision decision) => new
    {
        tool.Name,
        Description = Truncate(tool.Description),
        Parameters = Summarize(tool.InputSchema),
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
            foreach ((string name, JsonNode? schema) in Ordered(properties))
            {
                if (summary.Length > 0)
                {
                    summary.Append(", ");
                }
                string type = schema is JsonObject member
                    ? RequestBodyShape.TypeOf(member["type"]) ?? "any"
                    : "any";
                summary.Append(name).Append(": ").Append(type);
                if (required.Contains(name))
                {
                    summary.Append(" (required)");
                }
            }
        }
        return summary.ToString();
    }

    private static IEnumerable<KeyValuePair<string, JsonNode?>> Ordered(JsonObject properties)
    {
        List<KeyValuePair<string, JsonNode?>> numeric = [];
        List<KeyValuePair<string, JsonNode?>> rest = [];
        foreach (KeyValuePair<string, JsonNode?> property in properties)
        {
            if (IntegerLike(property.Key))
            {
                numeric.Add(property);
            }
            else
            {
                rest.Add(property);
            }
        }
        if (numeric.Count == 0)
        {
            return rest;
        }
        return numeric
            .OrderBy(p => uint.Parse(p.Key, CultureInfo.InvariantCulture))
            .Concat(rest);
    }

    private static bool IntegerLike(string key) =>
        key.Length > 0
        && (key.Length == 1 || key[0] != '0')
        && key.All(char.IsAsciiDigit)
        && uint.TryParse(key, CultureInfo.InvariantCulture, out _);

    private static IReadOnlySet<string> KnownFields(CatalogEntry entry)
    {
        HashSet<string> fields = new(StringComparer.Ordinal);
        if (entry.Tool.InputSchema["properties"] is JsonObject properties)
        {
            foreach ((string propertyName, _) in properties)
            {
                fields.Add(propertyName);
            }
        }
        return fields;
    }

    private static CallToolResult TextResult(string json, bool isError) => new()
    {
        IsError = isError,
        Content = [new TextContentBlock { Text = json }],
    };

    private static CallToolResult ErrorResult(string code, string message) =>
        TextResult(JsonSerializer.Serialize(new { error = code, message, retryable = false }, SkMcpJson.Wire), isError: true);

    private static CallToolResult UnknownTool(string name) =>
        ErrorResult("unknown_tool", $"No operation named '{name}'. Use search_tools to find the exact name.");
}
