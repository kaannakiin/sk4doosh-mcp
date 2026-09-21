using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Controllers;
using SkMcp.AspNetCore.Requests;
using SkMcp.AspNetCore.Spec;

namespace SkMcp.AspNetCore.Discovery;

/// <summary>What a value provider sees.</summary>
/// <remarks>
/// <see cref="Scopes"/> is best-effort here and authoritative on the Nest side: a
/// <c>ClaimsPrincipal</c> has no scope concept, so the <c>scope</c>/<c>scp</c> claim is parsed and
/// a host's JWT handler may have renamed it. An empty set means "unknown", not "none".
/// </remarks>
public sealed record McpCaller(
    string? Subject,
    string? ClientId,
    IReadOnlyList<string> Scopes,
    Func<string, string?> ClaimLookup,
    Func<string, string?> HeaderLookup)
{
    public string? Claim(string name) => ClaimLookup(name);

    public string? Header(string name) => HeaderLookup(name);
}

public delegate ValueTask<JsonNode?> McpValueProvider(
    McpCaller caller, CancellationToken cancellationToken);

public sealed record CurationTarget(
    Type? Controller = null,
    string? Action = null,
    string? Method = null,
    string? Route = null);

internal sealed record CurationRule(
    CurationTarget Target,
    IReadOnlyList<ArgumentCuration> Rules,
    bool Sealed)
{
    public int Specificity =>
        Target.Action is not null ? 3
        : Target.Controller is not null || Target.Route is not null ? 2
        : 1;

    public bool Matches(ActionDescriptor action, string method, string route)
    {
        ControllerActionDescriptor? controller = action as ControllerActionDescriptor;
        if (Target.Controller is not null
            && controller?.ControllerTypeInfo.AsType() != Target.Controller)
        {
            return false;
        }
        if (Target.Action is not null
            && !string.Equals(controller?.MethodInfo.Name, Target.Action, StringComparison.Ordinal))
        {
            return false;
        }
        if (Target.Method is not null
            && !string.Equals(Target.Method, method, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        return Target.Route is null || RouteGlob.Matches(Target.Route, route);
    }
}

/// <summary>Central curation, for controllers the host cannot decorate and rules that repeat.</summary>
/// <remarks>
/// <c>Seal</c> exists because plain "most specific wins" lets a method attribute defeat a tenancy
/// rule. A sealed field cannot be overridden by any layer.
/// </remarks>
public sealed class ArgumentCurationOptions
{
    private readonly Dictionary<string, McpValueProvider> providers = new(StringComparer.Ordinal);
    private readonly List<CurationRule> declarations = [];

    public IReadOnlyDictionary<string, McpValueProvider> Providers => providers;

    internal IReadOnlyList<CurationRule> Rules => declarations;

    public ArgumentCurationOptions Provide(string name, McpValueProvider provider)
    {
        providers[name] = provider;
        return this;
    }

    public ArgumentCurationOptions Curate(CurationTarget target, Action<McpCurationBuilder> configure)
    {
        ArgumentNullException.ThrowIfNull(configure);
        McpCurationBuilder builder = new();
        configure(builder);
        declarations.Add(new CurationRule(target, builder.Build(), Sealed: false));
        return this;
    }

    public ArgumentCurationOptions Everywhere(Action<McpCurationBuilder> configure) =>
        Curate(new CurationTarget(), configure);

    public ArgumentCurationOptions Seal(CurationTarget target, Action<McpCurationBuilder> configure)
    {
        ArgumentNullException.ThrowIfNull(configure);
        McpCurationBuilder builder = new();
        configure(builder);
        declarations.Add(new CurationRule(target, builder.Build(), Sealed: true));
        return this;
    }
}

public sealed class McpCurationBuilder
{
    private readonly Dictionary<string, ArgumentCuration> rules = new(StringComparer.Ordinal);

    public McpCurationBuilder Rename(string argument, string name) =>
        Set(argument, record => record with { As = name });

    public McpCurationBuilder Describe(string argument, string description) =>
        Set(argument, record => record with { Description = description });

    public McpCurationBuilder Hide(string argument, JsonNode? value) =>
        Set(argument, record => record with
        {
            Hidden = new ArgumentFill { Kind = ArgumentFillKind.Constant, Value = value },
        });

    public McpCurationBuilder HideFrom(string argument, string provider) =>
        Set(argument, record => record with
        {
            Hidden = new ArgumentFill { Kind = ArgumentFillKind.Deferred, Source = provider },
        });

    public McpCurationBuilder Omit(string argument) =>
        Set(argument, record => record with
        {
            Hidden = new ArgumentFill { Kind = ArgumentFillKind.Omit },
        });

    private McpCurationBuilder Set(string argument, Func<ArgumentCuration, ArgumentCuration> change)
    {
        rules.TryGetValue(argument, out ArgumentCuration? existing);
        rules[argument] = change(existing ?? new ArgumentCuration { Name = argument });
        return this;
    }

    internal IReadOnlyList<ArgumentCuration> Build() => [.. rules.Values];
}

internal static class CallerFactory
{
    public static McpCaller From(Microsoft.AspNetCore.Http.HttpContext? context)
    {
        System.Security.Claims.ClaimsPrincipal? user = context?.User;
        string? scope = user?.FindFirst("scope")?.Value ?? user?.FindFirst("scp")?.Value;
        return new McpCaller(
            user?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                ?? user?.FindFirst("sub")?.Value,
            user?.FindFirst("client_id")?.Value,
            scope is null ? [] : [.. scope.Split(' ', StringSplitOptions.RemoveEmptyEntries)],
            name => user?.FindFirst(name)?.Value,
            name => context?.Request.Headers.TryGetValue(name, out Microsoft.Extensions.Primitives.StringValues values) == true
                ? values.ToString()
                : null);
    }

    public static async ValueTask<IReadOnlyDictionary<string, JsonElement>?> ResolveAsync(
        RequestTemplate template,
        ArgumentCurationOptions options,
        McpCaller caller,
        CancellationToken cancellationToken)
    {
        HashSet<string> sources = new(StringComparer.Ordinal);
        void Take(ArgumentFill? fill)
        {
            if (fill is { Kind: ArgumentFillKind.Deferred, Source: { } source })
            {
                sources.Add(source);
            }
        }
        foreach (ParameterBinding parameter in template.Parameters)
        {
            Take(parameter.Fill);
        }
        foreach (ArgumentFill fill in template.BodyFills.Values)
        {
            Take(fill);
        }
        Take(template.RootFill);
        if (sources.Count == 0)
        {
            return null;
        }
        Dictionary<string, JsonElement> resolved = new(StringComparer.Ordinal);
        foreach (string source in sources)
        {
            if (!options.Providers.TryGetValue(source, out McpValueProvider? provider))
            {
                continue;
            }
            JsonNode? value = await provider(caller, cancellationToken).ConfigureAwait(false);
            if (value is not null)
            {
                resolved[source] = RequestTemplate.ToElement(value);
            }
        }
        return resolved;
    }
}
