using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Search;

namespace SkMcp.AspNetCore;

public sealed class SkMcpCatalogProvider(
    IApiDescriptionGroupCollectionProvider apiDescriptions,
    IOptions<SkMcpOptions> options,
    IOptions<JsonOptions> jsonOptions,
    IOptions<MvcOptions> mvcOptions,
    ILogger<SkMcpCatalogProvider> logger,
    IAuthorizationPolicyProvider? policyProvider = null)
{
    private const string NewtonsoftInputFormatter =
        "Microsoft.AspNetCore.Mvc.Formatters.NewtonsoftJsonInputFormatter";

    private static readonly HashSet<string> FatalCodes = new(StringComparer.Ordinal)
    {
        SkMcpCatalogException.NameCollision,
        SkMcpCatalogException.AmbiguousSelection,
        SkMcpCatalogException.InvalidName,
    };

    private sealed record Snapshot(
        CatalogBuildResult Result,
        IReadOnlyDictionary<string, CatalogEntry> ByName,
        ToolIndex Index,
        IReadOnlyList<CatalogDiagnostic> Fatal);

    private readonly object _gate = new();
    private ICollection<EndpointDataSource>? _dataSources;
    private string? _reservedPrefix;
    private Snapshot? _snapshot;

    public void Attach(ICollection<EndpointDataSource> dataSources, string reservedPrefix)
    {
        ArgumentNullException.ThrowIfNull(dataSources);
        lock (_gate)
        {
            _dataSources = dataSources;
            _reservedPrefix = reservedPrefix;
            _snapshot = null;
        }
    }

    public CatalogBuildResult Result => Current.Result;

    public CatalogEntry? Find(string name) =>
        Current.ByName.TryGetValue(name, out CatalogEntry? entry) ? entry : null;

    public IReadOnlyList<CatalogEntry> Search(string? query, int limit)
    {
        Snapshot snapshot = Current;
        return snapshot.Index.Search(query, limit)
            .Select(name => snapshot.ByName[name])
            .ToArray();
    }

    public void EnsureValid()
    {
        Snapshot snapshot = Current;
        if (snapshot.Fatal.Count == 0)
        {
            return;
        }
        throw new SkMcpCatalogException(
            snapshot.Fatal[0].Code,
            $"sk-mcp catalog has {snapshot.Fatal.Count} fatal diagnostic(s): "
            + string.Join(" | ", snapshot.Fatal.Select(d => d.Message)));
    }

    public void WarmUp()
    {
        Snapshot snapshot = Current;
        logger.LogInformation(
            "sk-mcp catalog: {Discovered} discovered, {Selected} selected, {Tools} tools, {Diagnostics} diagnostic(s)",
            snapshot.Result.Discovered, snapshot.Result.Selected,
            snapshot.Result.Entries.Count, snapshot.Result.Diagnostics.Count);
        foreach (CatalogDiagnostic diagnostic in snapshot.Result.Diagnostics)
        {
            if (FatalCodes.Contains(diagnostic.Code))
            {
                logger.LogError("sk-mcp {Code}: {Message}", diagnostic.Code, diagnostic.Message);
            }
            else
            {
                logger.LogWarning("sk-mcp {Code}: {Message}", diagnostic.Code, diagnostic.Message);
            }
        }
    }

    private Snapshot Current
    {
        get
        {
            lock (_gate)
            {
                return _snapshot ??= Build();
            }
        }
    }

    private Snapshot Build()
    {
        if (_dataSources is null)
        {
            throw new InvalidOperationException(
                "sk-mcp catalog is not attached to routing. Call app.MapSkMcp(...) after routing is configured.");
        }

        (Func<PropertyInfo, string> propertyName, CatalogDiagnostic? namingNote) = ResolvePropertyNaming();

        EndpointDataSource endpoints = new CompositeEndpointDataSource(_dataSources);
        bool hasFallbackPolicy = policyProvider is not null
            && policyProvider.GetFallbackPolicyAsync().GetAwaiter().GetResult() is not null;
        CatalogBuildResult result = EndpointCatalog.Build(
            apiDescriptions, endpoints, options.Value.Selection.Default,
            reservedRoutePrefix: _reservedPrefix, propertyName: propertyName,
            hasFallbackPolicy: hasFallbackPolicy,
            prefixMode: options.Value.Naming.PrefixMode,
            containerPrefix: options.Value.Naming.Prefix);
        if (namingNote is not null)
        {
            result = result with { Diagnostics = [namingNote, .. result.Diagnostics] };
        }

        Dictionary<string, CatalogEntry> byName = result.Entries
            .ToDictionary(e => e.Tool.Name, StringComparer.Ordinal);
        ToolIndex index = new(result.Entries.Select(e => new SearchDocument(
            e.Tool.Name,
            e.Tool.Description,
            e.Descriptor.Tags ?? [],
            e.Descriptor.Route)));
        CatalogDiagnostic[] fatal = result.Diagnostics
            .Where(d => FatalCodes.Contains(d.Code))
            .ToArray();

        return new Snapshot(result, byName, index, fatal);
    }

    private (Func<PropertyInfo, string>, CatalogDiagnostic?) ResolvePropertyNaming()
    {
        if (options.Value.Schema.PropertyName is { } declared)
        {
            return (declared, null);
        }

        bool newtonsoft = mvcOptions.Value.InputFormatters
            .Any(f => f.GetType().FullName == NewtonsoftInputFormatter);
        if (newtonsoft)
        {
            return (property => property.Name, new CatalogDiagnostic(
                "naming_policy_unresolved",
                "Newtonsoft.Json input formatter detected; body property names use CLR names. Set options.Schema.PropertyName to mirror your ContractResolver if it renames properties."));
        }

        JsonSerializerOptions serializer = jsonOptions.Value.JsonSerializerOptions;
        return (property =>
            property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name
            ?? serializer.PropertyNamingPolicy?.ConvertName(property.Name)
            ?? property.Name, null);
    }
}
