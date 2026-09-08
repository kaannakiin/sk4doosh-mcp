using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Caching;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Tools;
using SkMcp.AspNetCore.Visibility;
using SkMcp.AspNetCore.Visibility.Probe;
using static SkMcp.Tests.VisibilityHost;

namespace SkMcp.Tests;

[AttributeUsage(AttributeTargets.Method)]
internal sealed class DynamicGrantAttribute : Attribute, IAuthorizationFilter
{
    public static readonly HashSet<string> Grants = new(StringComparer.Ordinal);

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        string? name = context.HttpContext.User.Identity?.Name;
        if (name is null || !Grants.Contains(name))
        {
            context.Result = new StatusCodeResult(StatusCodes.Status403Forbidden);
        }
    }
}

internal sealed class TaggingScopeResolver(ICallerScopeResolver inner) : ICallerScopeResolver
{
    public CallerScope Resolve(HttpRequest? outerRequest)
    {
        CallerScope scope = inner.Resolve(outerRequest);
        string? user = outerRequest?.Headers["X-User"].ToString();
        return string.IsNullOrEmpty(user) ? scope : new CallerScope(scope.Key, [.. scope.Tags, $"user:{user}"]);
    }
}

internal sealed class TenantScopeResolver : ICallerScopeResolver
{
    public CallerScope Resolve(HttpRequest? outerRequest)
    {
        string tenant = outerRequest?.Headers["X-Tenant"].ToString() is { Length: > 0 } value ? value : "none";
        return new CallerScope(tenant, []);
    }
}

internal sealed class ManualTimeProvider : TimeProvider
{
    private DateTimeOffset _now = DateTimeOffset.UtcNow;

    public override DateTimeOffset GetUtcNow() => _now;

    public void Advance(TimeSpan delta) => _now += delta;
}

internal sealed class RecordingCache : ISkMcpCache
{
    private readonly ConcurrentDictionary<string, string> _values = new(StringComparer.Ordinal);

    public int GetCalls;
    public int SetCalls;

    public ValueTask<string?> GetAsync(CacheKey key, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref GetCalls);
        return new ValueTask<string?>(_values.TryGetValue(key.ToString(), out string? value) ? value : null);
    }

    public ValueTask SetAsync(CacheKey key, string value, TimeSpan lifetime, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref SetCalls);
        _values[key.ToString()] = value;
        return ValueTask.CompletedTask;
    }

    public ValueTask RemoveScopeAsync(string scopeKey, CancellationToken cancellationToken)
    {
        foreach (string existing in _values.Keys.Where(k => k.StartsWith($"skmcp:v1:{scopeKey}:", StringComparison.Ordinal)))
        {
            _values.TryRemove(existing, out _);
        }
        return ValueTask.CompletedTask;
    }

    public ValueTask RemoveTagAsync(string tag, CancellationToken cancellationToken) => ValueTask.CompletedTask;

    public ValueTask ClearAsync(CancellationToken cancellationToken)
    {
        _values.Clear();
        return ValueTask.CompletedTask;
    }
}

internal sealed class CountingVisibilityEvaluator(IVisibilityEvaluator inner) : IVisibilityEvaluator
{
    public int Calls;

    public Task<CallerFacts> ResolveAsync(
        HttpRequest? outerRequest, IReadOnlySet<string> policyNames, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref Calls);
        return inner.ResolveAsync(outerRequest, policyNames, cancellationToken);
    }
}

public sealed class CacheTests
{
    [Fact]
    public void K1_SameCarriers_SameKey()
    {
        string a = CarrierHashCallerScopeResolver.DigestInput(["Authorization"], _ => "Bearer abc");
        string b = CarrierHashCallerScopeResolver.DigestInput(["Authorization"], _ => "Bearer abc");
        Assert.Equal(a, b);
    }

    [Fact]
    public void K2_DifferentCarrierValue_DifferentKey_UndeclaredHeaderIgnored()
    {
        IOptions<SkMcpOptions> options = Options.Create(new SkMcpOptions());
        CarrierHashCallerScopeResolver resolver = new(options);

        DefaultHttpContext a = new();
        a.Request.Headers.Authorization = "Bearer abc";
        DefaultHttpContext b = new();
        b.Request.Headers.Authorization = "Bearer xyz";
        DefaultHttpContext c = new();
        c.Request.Headers.Authorization = "Bearer abc";
        c.Request.Headers["X-Undeclared"] = "irrelevant";

        string keyA = resolver.Resolve(a.Request).Key;
        string keyB = resolver.Resolve(b.Request).Key;
        string keyC = resolver.Resolve(c.Request).Key;

        Assert.NotEqual(keyA, keyB);
        Assert.Equal(keyA, keyC);
    }

    [Fact]
    public void K3_Key_Is64LowercaseHexAndContainsNoPlaintext()
    {
        string key = CarrierHashCallerScopeResolver.DigestInput(["Authorization"], _ => "Bearer super-secret-token");
        Assert.Equal(64, key.Length);
        Assert.Matches(new Regex("^[0-9a-f]{64}$"), key);
        Assert.DoesNotContain("super-secret-token", key, StringComparison.Ordinal);
    }

    [Fact]
    public async Task K4_Facts_ComputedOnceWithinLifetime()
    {
        CountingVisibilityEvaluator? counting = null;
        await using Harness host = await HostAsync(beforeSkMcp: services =>
            services.AddSingleton<IVisibilityEvaluator>(sp =>
            {
                counting = new CountingVisibilityEvaluator(new DeclarativeVisibilityEvaluator(
                    sp.GetRequiredService<SyntheticRequestFactory>()));
                return counting;
            }));
        SkMcpMetaTools tools = host.ToolsFor(Mint("alice", ordersRead: true));

        await SearchAsync(tools);
        await SearchAsync(tools);

        Assert.Equal(1, counting!.Calls);
    }

    [Fact]
    public async Task K5_SingleFlight_ParallelSearches_ProbeOnce()
    {
        await using Harness host = await ProbeHostAsync();
        SkMcpMetaTools tools = host.ToolsFor(Mint("alice"));
        Interlocked.Exchange(ref host.Probes.UndeclaredHits, 0);

        await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => SearchAsync(tools)));

        Assert.Equal(1, Volatile.Read(ref host.Probes.UndeclaredHits));
    }

    [Fact]
    public async Task K5_SingleFlight_ParallelHosts_HaveIndependentProbeCounts()
    {
        await using Harness first = await ProbeHostAsync();
        await using Harness second = await ProbeHostAsync();
        SkMcpMetaTools firstTools = first.ToolsFor(Mint("alice"));
        SkMcpMetaTools secondTools = second.ToolsFor(Mint("alice"));

        await Task.WhenAll(Enumerable.Range(0, 5).SelectMany(_ =>
            new[] { SearchAsync(firstTools), SearchAsync(secondTools) }));

        Assert.Equal(1, Volatile.Read(ref first.Probes.UndeclaredHits));
        Assert.Equal(1, Volatile.Read(ref second.Probes.UndeclaredHits));
    }

    [Fact]
    public async Task K6_Ttl_IsAbsoluteAndDoesNotSlideOnTouch()
    {
        ManualTimeProvider clock = new();
        CountingVisibilityEvaluator? counting = null;
        await using Harness host = await HostAsync(
            configure: o => o.Cache.Lifetime = TimeSpan.FromSeconds(100),
            beforeSkMcp: services =>
            {
                services.AddSingleton<TimeProvider>(clock);
                services.AddSingleton<IVisibilityEvaluator>(sp =>
                {
                    counting = new CountingVisibilityEvaluator(new DeclarativeVisibilityEvaluator(
                        sp.GetRequiredService<SyntheticRequestFactory>()));
                    return counting;
                });
            });
        SkMcpMetaTools tools = host.ToolsFor(Mint("alice", ordersRead: true));

        await SearchAsync(tools);
        Assert.Equal(1, counting!.Calls);

        clock.Advance(TimeSpan.FromSeconds(50));
        await SearchAsync(tools);
        Assert.Equal(1, counting.Calls);

        clock.Advance(TimeSpan.FromSeconds(70));
        await SearchAsync(tools);
        Assert.Equal(2, counting.Calls);
    }

    [Fact]
    public async Task K7_MaxCallers_EvictsLeastRecentlyUsedScope()
    {
        await using Harness host = await ProbeHostAsync(o => o.Cache.MaxCallers = 1);
        SkMcpMetaTools alice = host.ToolsFor(Mint("alice"));
        Interlocked.Exchange(ref host.Probes.UndeclaredHits, 0);

        await SearchAsync(alice);
        await SearchAsync(host.ToolsFor(Mint("bob")));
        await SearchAsync(alice);

        Assert.Equal(3, Volatile.Read(ref host.Probes.UndeclaredHits));
    }

    [Fact]
    public async Task K8_LifetimeZero_BypassesCacheEntirely()
    {
        await using Harness host = await ProbeHostAsync(o => o.Cache.Lifetime = TimeSpan.Zero);
        SkMcpMetaTools tools = host.ToolsFor(Mint("alice"));
        Interlocked.Exchange(ref host.Probes.UndeclaredHits, 0);

        await SearchAsync(tools);
        await SearchAsync(tools);

        Assert.Equal(2, Volatile.Read(ref host.Probes.UndeclaredHits));
    }

    [Fact]
    public async Task K9_InvalidateCaller_AffectsOnlyThatCaller()
    {
        await using Harness host = await ProbeHostAsync();
        DynamicGrantAttribute.Grants.Clear();
        DynamicGrantAttribute.Grants.Add("alice");
        DynamicGrantAttribute.Grants.Add("bob");
        string aliceToken = Mint("alice");
        string bobToken = Mint("bob");
        SkMcpMetaTools aliceTools = host.ToolsFor(aliceToken);
        SkMcpMetaTools bobTools = host.ToolsFor(bobToken);

        Assert.Contains("vis_dynamic", (await SearchAsync(aliceTools)).Names);
        Assert.Contains("vis_dynamic", (await SearchAsync(bobTools)).Names);

        DynamicGrantAttribute.Grants.Clear();

        ICallerScopeResolver resolver = host.App.Services.GetRequiredService<ICallerScopeResolver>();
        ISkMcpCacheInvalidator invalidator = host.App.Services.GetRequiredService<ISkMcpCacheInvalidator>();
        DefaultHttpContext aliceContext = new();
        aliceContext.Request.Headers.Authorization = $"Bearer {aliceToken}";
        await invalidator.InvalidateCallerAsync(resolver.Resolve(aliceContext.Request));

        Assert.DoesNotContain("vis_dynamic", (await SearchAsync(aliceTools)).Names);
        Assert.Contains("vis_dynamic", (await SearchAsync(bobTools)).Names);
    }

    [Fact]
    public async Task K10_InvalidateTag_AffectsAllSessionsSharingTag()
    {
        await using Harness host = await ProbeHostAsync(beforeSkMcp: services =>
            services.AddSingleton<ICallerScopeResolver>(sp =>
                new TaggingScopeResolver(new CarrierHashCallerScopeResolver(sp.GetRequiredService<IOptions<SkMcpOptions>>()))));
        DynamicGrantAttribute.Grants.Clear();
        DynamicGrantAttribute.Grants.Add("alice");

        SkMcpMetaTools session1 = host.ToolsFor(Mint("alice", role: "session1"), ("X-User", "alice"));
        SkMcpMetaTools session2 = host.ToolsFor(Mint("alice", role: "session2"), ("X-User", "alice"));

        Assert.Contains("vis_dynamic", (await SearchAsync(session1)).Names);
        Assert.Contains("vis_dynamic", (await SearchAsync(session2)).Names);

        DynamicGrantAttribute.Grants.Clear();
        ISkMcpCacheInvalidator invalidator = host.App.Services.GetRequiredService<ISkMcpCacheInvalidator>();
        await invalidator.InvalidateTagAsync("user:alice");

        Assert.DoesNotContain("vis_dynamic", (await SearchAsync(session1)).Names);
        Assert.DoesNotContain("vis_dynamic", (await SearchAsync(session2)).Names);
    }

    [Fact]
    public async Task K11_InvalidateAll_AffectsEveryone()
    {
        await using Harness host = await ProbeHostAsync();
        DynamicGrantAttribute.Grants.Clear();
        DynamicGrantAttribute.Grants.Add("alice");
        DynamicGrantAttribute.Grants.Add("bob");

        SkMcpMetaTools aliceTools = host.ToolsFor(Mint("alice"));
        SkMcpMetaTools bobTools = host.ToolsFor(Mint("bob"));
        Assert.Contains("vis_dynamic", (await SearchAsync(aliceTools)).Names);
        Assert.Contains("vis_dynamic", (await SearchAsync(bobTools)).Names);

        DynamicGrantAttribute.Grants.Clear();
        ISkMcpCacheInvalidator invalidator = host.App.Services.GetRequiredService<ISkMcpCacheInvalidator>();
        await invalidator.InvalidateAllAsync();

        Assert.DoesNotContain("vis_dynamic", (await SearchAsync(aliceTools)).Names);
        Assert.DoesNotContain("vis_dynamic", (await SearchAsync(bobTools)).Names);
    }

    [Fact]
    public async Task K12_DoneCriterion_GrantRevokeInvalidateWithoutRestart()
    {
        await using Harness host = await ProbeHostAsync(beforeSkMcp: services =>
            services.AddSingleton<ICallerScopeResolver>(sp =>
                new TaggingScopeResolver(new CarrierHashCallerScopeResolver(sp.GetRequiredService<IOptions<SkMcpOptions>>()))));
        DynamicGrantAttribute.Grants.Clear();
        DynamicGrantAttribute.Grants.Add("alice");
        DynamicGrantAttribute.Grants.Add("bob");

        SkMcpMetaTools alice = host.ToolsFor(Mint("alice"), ("X-User", "alice"));
        SkMcpMetaTools bob = host.ToolsFor(Mint("bob"), ("X-User", "bob"));

        Assert.Contains("vis_dynamic", (await SearchAsync(alice)).Names);
        Assert.Contains("vis_dynamic", (await SearchAsync(bob)).Names);

        DynamicGrantAttribute.Grants.Remove("alice");

        Assert.Contains("vis_dynamic", (await SearchAsync(alice)).Names);
        Assert.Equal(403, await InvokeStatusAsync(alice, "vis_dynamic", new { }));

        ISkMcpCacheInvalidator invalidator = host.App.Services.GetRequiredService<ISkMcpCacheInvalidator>();
        await invalidator.InvalidateTagAsync("user:alice");

        Assert.DoesNotContain("vis_dynamic", (await SearchAsync(alice)).Names);
        Assert.Contains("vis_dynamic", (await SearchAsync(bob)).Names);
    }

    [Fact]
    public async Task K13_HostCache_RegisteredBeforeAddSkMcp_IsUsed()
    {
        RecordingCache recording = new();
        await using Harness host = await HostAsync(beforeSkMcp: services =>
            services.AddSingleton<ISkMcpCache>(recording));
        await SearchAsync(host.ToolsFor(Mint("alice", ordersRead: true)));

        Assert.True(recording.SetCalls > 0);
    }

    [Fact]
    public async Task K14_HostCache_RegisteredAfterAddSkMcp_IsUsed()
    {
        RecordingCache recording = new();
        await using Harness host = await HostAsync(afterSkMcp: services =>
            services.AddSingleton<ISkMcpCache>(recording));
        await SearchAsync(host.ToolsFor(Mint("alice", ordersRead: true)));

        Assert.True(recording.SetCalls > 0);
    }

    [Fact]
    public async Task K15_HostResolver_CollapsesTwoTokensIntoOneScope()
    {
        await using Harness host = await HostAsync(beforeSkMcp: services =>
            services.AddSingleton<ICallerScopeResolver, TenantScopeResolver>());

        SkMcpMetaTools first = host.ToolsFor(Mint("alice", ordersRead: true), ("X-Tenant", "acme"));
        SkMcpMetaTools second = host.ToolsFor(Mint("bob"), ("X-Tenant", "acme"));

        (HashSet<string> firstNames, _, _, _) = await SearchAsync(first);
        (HashSet<string> secondNames, _, _, _) = await SearchAsync(second);

        Assert.Equal(firstNames, secondNames);
    }

    [Fact]
    public async Task K16_CatalogReload_ClearsCacheAndDisabledSet_SignalsChangeToken()
    {
        CountingVisibilityEvaluator? counting = null;
        await using Harness host = await ProbeHostAsync(beforeSkMcp: services =>
            services.AddSingleton<IVisibilityEvaluator>(sp =>
            {
                counting = new CountingVisibilityEvaluator(new DeclarativeVisibilityEvaluator(
                    sp.GetRequiredService<SyntheticRequestFactory>()));
                return counting;
            }));
        SkMcpCatalogProvider catalog = host.App.Services.GetRequiredService<SkMcpCatalogProvider>();
        IProbeEvaluator probe = host.App.Services.GetRequiredService<IProbeEvaluator>();
        CatalogEntry regexEntry = catalog.Find("vis_regex")!;

        long generationBefore = catalog.Generation;
        IChangeToken tokenBefore = catalog.GetChangeToken();
        bool signaled = false;
        tokenBefore.RegisterChangeCallback(_ => signaled = true, null);

        Assert.True(probe.CanProbe(regexEntry));
        Assert.Equal(VisibilityDecision.Unknown, await probe.ProbeAsync(regexEntry, null, CancellationToken.None));
        Assert.False(probe.CanProbe(regexEntry));

        SkMcpMetaTools alice = host.ToolsFor(Mint("alice"));
        await SearchAsync(alice);
        Assert.Equal(1, counting!.Calls);

        await SearchAsync(alice);
        Assert.Equal(1, counting.Calls);

        await catalog.ReloadAsync();

        Assert.True(signaled);
        Assert.Equal(generationBefore + 1, catalog.Generation);
        Assert.True(probe.CanProbe(regexEntry));

        await SearchAsync(alice);
        Assert.Equal(2, counting.Calls);
    }

    [Fact]
    public async Task K17_InvalidateAll_DoesNotClearDisabledSetOrBumpGeneration()
    {
        await using Harness host = await ProbeHostAsync();
        SkMcpCatalogProvider catalog = host.App.Services.GetRequiredService<SkMcpCatalogProvider>();
        IProbeEvaluator probe = host.App.Services.GetRequiredService<IProbeEvaluator>();
        CatalogEntry regexEntry = catalog.Find("vis_regex")!;
        long generationBefore = catalog.Generation;

        Assert.Equal(VisibilityDecision.Unknown, await probe.ProbeAsync(regexEntry, null, CancellationToken.None));
        Assert.False(probe.CanProbe(regexEntry));

        ISkMcpCacheInvalidator invalidator = host.App.Services.GetRequiredService<ISkMcpCacheInvalidator>();
        await invalidator.InvalidateAllAsync();

        Assert.Equal(generationBefore, catalog.Generation);
        Assert.False(probe.CanProbe(regexEntry));
    }

    [Fact]
    public async Task K18_InvalidOptions_ThrowsAtStartup()
    {
        await Assert.ThrowsAsync<OptionsValidationException>(
            () => HostAsync(configure: o => o.Cache.MaxCallers = 0));
    }

    [Fact]
    public void K19_AddSkMcp_CalledTwice_RegistersOnce()
    {
        ServiceCollection services = new();
        services.AddSkMcp();
        services.AddSkMcp();

        Assert.Single(services, d => d.ServiceType == typeof(SkMcpCatalogProvider));
        Assert.Single(services, d => d.ServiceType == typeof(IAuthorizationMiddlewareResultHandler));
    }
}
