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
using SkMcp.AspNetCore.Requests;
using SkMcp.AspNetCore.Spec;
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
    public async Task<CallToolResult> SearchTools(
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

        return Respond(new { total, results }, isError: false, summaryOf: results, narrowing: SearchNarrowing);
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
        return Respond(new
        {
            entry.Tool.Name,
            entry.Tool.Description,
            entry.Tool.InputSchema,
            entry.Tool.OutputSchema,
            entry.Tool.Annotations,
            AuthUncertain = Uncertain(decision),
        }, isError: false);
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
        if (entry.Template is not { } template)
        {
            return ErrorResult(SdkErrorCode.NotInvocable, $"Operation '{name}' cannot be invoked through sk-mcp; see the catalog diagnostics.");
        }

        try
        {
            IReadOnlyDictionary<string, JsonElement>? deferred = await CallerFactory.ResolveAsync(
                template,
                options.Value.Arguments,
                CallerFactory.From(httpContextAccessor.HttpContext),
                cancellationToken);
            InvokeTarget target = new(entry.Tool.Name, entry.Descriptor.Method, entry.Descriptor.Route);
            TimeSpan deadline = TimeoutFor(target);
            DispatchResult result;
            try
            {
                result = await dispatcher.DispatchAsync(
                    template, arguments, httpContextAccessor.HttpContext?.Request, cancellationToken,
                    deferred, deadline);
            }
            catch (SkMcpDispatchTimeout)
            {
                return Respond(
                    SdkErrors.RefuseTimedOut((int)deadline.TotalMilliseconds),
                    isError: true);
            }
            InvokeOutcome outcome = mapper.Map(result.ToBackendResponse(), VocabularyOf(entry, template));
            IReadOnlyList<FieldError> narrowing = SdkErrors.NarrowingArguments(entry.Tool.InputSchema);
            return outcome switch
            {
                InvokeSucceeded succeeded => Respond(
                    succeeded.Success, isError: false,
                    summaryOf: succeeded.Success.Body, narrowing: narrowing, target: target),
                InvokeFailed failed => Respond(
                    failed.Error, isError: true, narrowing: narrowing, target: target),
                _ => throw new InvalidOperationException($"Unhandled invoke outcome: {outcome.GetType()}"),
            };
        }
        catch (SkMcpArgumentException ex)
        {
            return Respond(
                SdkErrors.Create(JsonSerializer.Deserialize<SdkErrorCode>($"\"{ex.Code}\"", SkMcpJson.Wire), ex.Message),
                isError: true);
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

    /// <summary>
    /// The wire names the backend reports, mapped back to the names the agent knows.
    /// </summary>
    /// <remarks>
    /// Without it a rename leaks the wire vocabulary into the reported field name and points the
    /// agent at an argument it does not have.
    /// </remarks>
    private static FieldVocabulary VocabularyOf(CatalogEntry entry, RequestTemplate template)
    {
        Dictionary<string, string> aliases = new(StringComparer.Ordinal);
        HashSet<string> hidden = new(StringComparer.Ordinal);
        foreach (ParameterBinding parameter in template.Parameters)
        {
            if (parameter.Fill is not null)
            {
                hidden.Add(parameter.Name);
            }
            else if (parameter.Argument is { } agentName)
            {
                aliases[parameter.Name] = agentName;
            }
        }
        foreach ((string agentKey, string wireField) in template.BodyAliases)
        {
            aliases[wireField] = agentKey;
        }
        hidden.UnionWith(template.BodyFills.Keys);
        return new FieldVocabulary(KnownFields(entry), aliases, hidden);
    }

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

    private static readonly IReadOnlyList<FieldError> SearchNarrowing =
    [
        new FieldError { Name = "query", Message = "Keywords that select fewer operations." },
        new FieldError { Name = "limit", Message = "Maximum number of results, 1-50." },
    ];

    private static CallToolResult Wire(string json, bool isError) => new()
    {
        IsError = isError,
        Content = [new TextContentBlock { Text = json }],
    };

    /// <summary>
    /// The single place a meta-tool answer becomes a wire result, so none of them can reach the
    /// agent without passing the payload budget. <see cref="SkMcpBudgetTool"/> backs it up for any
    /// tool added to this type later. Pinned by ResponseBudgetTests.
    /// </summary>
    /// <param name="payload">The value to emit.</param>
    /// <param name="isError">Whether the answer is an error.</param>
    /// <param name="summaryOf">The value a refusal summarises; <paramref name="payload"/> when null.</param>
    /// <param name="narrowing">The arguments a refusal names as narrowing this call.</param>
    /// <param name="target">The endpoint a per-endpoint budget override sees.</param>
    private CallToolResult Respond(
        object payload,
        bool isError,
        object? summaryOf = null,
        IReadOnlyList<FieldError>? narrowing = null,
        InvokeTarget? target = null)
    {
        string json = JsonSerializer.Serialize(payload, SkMcpJson.Wire);
        int bytes = Encoding.UTF8.GetByteCount(json);
        int limit = BudgetFor(target);
        if (bytes <= limit)
        {
            return Wire(json, isError);
        }
        SdkError refusal = SdkErrors.RefuseOversize(new OversizeResponse(
            bytes,
            limit,
            SdkErrors.Describe(JsonSerializer.SerializeToNode(summaryOf ?? payload, SkMcpJson.Wire)),
            narrowing));
        return Wire(JsonSerializer.Serialize(refusal, SkMcpJson.Wire), isError: true);
    }

    private int BudgetFor(InvokeTarget? target)
    {
        InvokeOptions invoke = options.Value.Invoke;
        int? over = target is { } value ? invoke.MaxResponseBytesFor?.Invoke(value) : null;
        return over ?? invoke.MaxResponseBytes;
    }

    private TimeSpan TimeoutFor(InvokeTarget target)
    {
        InvokeOptions invoke = options.Value.Invoke;
        return invoke.TimeoutFor?.Invoke(target) ?? invoke.Timeout;
    }

    private CallToolResult ErrorResult(SdkErrorCode code, string message) =>
        Respond(SdkErrors.Create(code, message), isError: true);

    private CallToolResult UnknownTool(string name) =>
        ErrorResult(SdkErrorCode.UnknownTool, $"No operation named '{name}'. Use search_tools to find the exact name.");
}
