using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Tools;
using SkMcp.AspNetCore.Visibility;
using SkMcp.AspNetCore.Visibility.Probe;

namespace SkMcp.Tests;

public sealed class OwnerRequirement : IAuthorizationRequirement;

public sealed class OwnerHandler : AuthorizationHandler<OwnerRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, OwnerRequirement requirement)
    {
        if (context.Resource is not null)
        {
            context.Succeed(requirement);
        }
        return Task.CompletedTask;
    }
}

[AttributeUsage(AttributeTargets.Method)]
public sealed class AliceOnlyAttribute : Attribute, IAuthorizationFilter
{
    public void OnAuthorization(AuthorizationFilterContext context)
    {
        if (context.HttpContext.User.Identity?.Name != "alice")
        {
            context.Result = new StatusCodeResult(StatusCodes.Status403Forbidden);
        }
    }
}

[AttributeUsage(AttributeTargets.Method)]
public sealed class CustomGateAttribute : Attribute, IAuthorizationFilter
{
    public void OnAuthorization(AuthorizationFilterContext context)
    {
    }
}

[ApiController]
[Route("/vis")]
[McpTool(Prefix = "vis")]
public sealed class VisibilityController : ControllerBase
{
    public static int SideEffects;

    [HttpGet("anon")]
    [AllowAnonymous]
    public IActionResult VisAnon() => Ok();

    [HttpPost("effect")]
    [Authorize]
    [AliceOnly]
    public IActionResult VisEffect()
    {
        Interlocked.Increment(ref SideEffects);
        return Ok();
    }

    [HttpGet("gated")]
    [CustomGate]
    public IActionResult VisGated() => Ok();

    [HttpGet("probeflag")]
    [AllowAnonymous]
    public IActionResult VisProbeFlag() => Ok(new
    {
        probe = HttpContext.IsSkMcpProbe(),
        synthetic = HttpContext.IsSkMcpRequest(),
        remote = HttpContext.Connection.RemoteIpAddress is { } ip
            ? $"{ip}:{HttpContext.Connection.RemotePort}"
            : null,
    });

    [HttpGet("bare")]
    [Authorize]
    public IActionResult VisBare() => Ok();

    [HttpGet("undeclared")]
    public IActionResult VisUndeclared() => Ok();

    [HttpGet("claim")]
    [Authorize(Policy = "OrdersRead")]
    public IActionResult VisClaim() => Ok();

    [HttpGet("role")]
    [Authorize(Roles = "admin")]
    public IActionResult VisRole() => Ok();

    [HttpGet("assert")]
    [Authorize(Policy = "Assertion")]
    public IActionResult VisAssert() => Ok();

    [HttpGet("owner")]
    [Authorize(Policy = "Owner")]
    public IActionResult VisOwner() => Ok();

    [HttpGet("filter")]
    [Authorize]
    [AliceOnly]
    public IActionResult VisFilter() => Ok();

    [HttpGet("mine/{id:int}")]
    [Authorize]
    public IActionResult VisMine(int id) => id == 1 ? Ok() : Forbid();
}

public sealed class VisibilityTests
{
    private sealed record Harness(WebApplication App, SkMcpDispatcher Dispatcher) : IAsyncDisposable
    {
        public SkMcpMetaTools ToolsFor(string? token, params (string Name, string Value)[] headers)
        {
            DefaultHttpContext outer = new();
            if (token is not null)
            {
                outer.Request.Headers.Authorization = $"Bearer {token}";
            }
            foreach ((string name, string value) in headers)
            {
                outer.Request.Headers[name] = value;
            }
            return new SkMcpMetaTools(
                App.Services.GetRequiredService<SkMcpCatalogProvider>(),
                Dispatcher,
                App.Services.GetRequiredService<IVisibilityEvaluator>(),
                App.Services.GetRequiredService<IProbeEvaluator>(),
                App.Services.GetRequiredService<IOptions<SkMcpOptions>>(),
                new HttpContextAccessor { HttpContext = outer });
        }

        public async ValueTask DisposeAsync()
        {
            await App.StopAsync();
            await App.DisposeAsync();
        }
    }

    private static string Mint(string name, bool ordersRead = false, string? role = null)
    {
        List<Claim> claims = [new(ClaimTypes.Name, name)];
        if (ordersRead)
        {
            claims.Add(new Claim("orders.read", "true"));
        }
        if (role is not null)
        {
            claims.Add(new Claim(ClaimTypes.Role, role));
        }
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Expires = DateTime.UtcNow.AddHours(1),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Hosts.SigningKey)),
                SecurityAlgorithms.HmacSha256),
        });
    }

    private static async Task<Harness> HostAsync(bool authentication = true, Action<SkMcpOptions>? configure = null)
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(VisibilityTests).Assembly);
        if (authentication)
        {
            builder.Services
                .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                .AddJwtBearer(o => o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Hosts.SigningKey)),
                });
        }
        builder.Services.AddAuthorization(o =>
        {
            o.AddPolicy("OrdersRead", p => p.RequireClaim("orders.read", "true"));
            o.AddPolicy("Assertion", p => p.RequireAssertion(_ => true));
            o.AddPolicy("Owner", p => p.AddRequirements(new OwnerRequirement()));
        });
        builder.Services.AddSingleton<IAuthorizationHandler, OwnerHandler>();
        builder.Services.AddSkMcp(configure);

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.Use(async (context, next) =>
        {
            bool gated = context.GetEndpoint()?.Metadata.GetMetadata<CustomGateAttribute>() is not null;
            if (gated && context.Request.Headers["X-Gate"] != "open")
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
            if (context.Request.Path.StartsWithSegments("/vis/undeclared")
                && !context.Request.Headers.ContainsKey("Authorization"))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
            await next();
        });
        if (authentication)
        {
            app.UseAuthentication();
            app.UseAuthorization();
        }
        app.MapControllers();
        app.MapGet("/vis/minimal", () => "ok")
            .RequireAuthorization("OrdersRead")
            .WithMetadata(new McpToolAttribute());
        app.MapPost("/vis/minimal-post", () => "ok")
            .RequireAuthorization("Assertion")
            .WithMetadata(new McpToolAttribute());
        app.MapSkMcp("/mcp");
        await app.StartAsync();
        return new Harness(app, app.Services.GetRequiredService<SkMcpDispatcher>());
    }

    private static async Task<(HashSet<string> Names, HashSet<string> Uncertain, int Total, string Raw)> SearchAsync(
        SkMcpMetaTools tools, string query = "")
    {
        string raw = await tools.SearchTools(query, SkMcpMetaTools.MaxLimit);
        using JsonDocument document = JsonDocument.Parse(raw);
        HashSet<string> names = new(StringComparer.Ordinal);
        HashSet<string> uncertain = new(StringComparer.Ordinal);
        foreach (JsonElement card in document.RootElement.GetProperty("results").EnumerateArray())
        {
            string name = card.GetProperty("name").GetString()!;
            names.Add(name);
            if (card.TryGetProperty("authUncertain", out JsonElement flag) && flag.GetBoolean())
            {
                uncertain.Add(name);
            }
        }
        return (names, uncertain, document.RootElement.GetProperty("total").GetInt32(), raw);
    }

    private static async Task<int> InvokeStatusAsync(SkMcpMetaTools tools, string name, object arguments)
    {
        string raw = await tools.InvokeTool(name, JsonSerializer.SerializeToElement(arguments), CancellationToken.None);
        using JsonDocument document = JsonDocument.Parse(raw);
        return document.RootElement.TryGetProperty("status", out JsonElement status)
            ? status.GetInt32()
            : throw new Xunit.Sdk.XunitException(raw);
    }

    [Fact]
    public async Task V1_AnonymousEndpoint_VisibleWithoutIdentity()
    {
        await using Harness host = await HostAsync();
        (HashSet<string> names, HashSet<string> uncertain, _, _) = await SearchAsync(host.ToolsFor(null));
        Assert.Contains("vis_anon", names);
        Assert.DoesNotContain("vis_anon", uncertain);
    }

    [Fact]
    public async Task V2_IdentityRequired_HiddenWithoutIdentity()
    {
        await using Harness host = await HostAsync();
        (HashSet<string> names, _, _, _) = await SearchAsync(host.ToolsFor(null));
        Assert.DoesNotContain("vis_bare", names);
        Assert.DoesNotContain("vis_claim", names);
        Assert.DoesNotContain("get_vis_minimal", names);
    }

    [Fact]
    public async Task V3_SameQuery_TwoIdentities_TwoLists()
    {
        await using Harness host = await HostAsync();
        (HashSet<string> alice, _, int aliceTotal, _) = await SearchAsync(host.ToolsFor(Mint("alice", ordersRead: true)));
        (HashSet<string> bob, _, int bobTotal, _) = await SearchAsync(host.ToolsFor(Mint("bob")));

        Assert.Contains("vis_claim", alice);
        Assert.Contains("get_vis_minimal", alice);
        Assert.DoesNotContain("vis_claim", bob);
        Assert.DoesNotContain("get_vis_minimal", bob);
        Assert.Contains("vis_bare", alice);
        Assert.Contains("vis_bare", bob);
        Assert.True(aliceTotal > bobTotal);
    }

    [Fact]
    public async Task V4_RoleRequirement_EvaluatedDeclaratively()
    {
        await using Harness host = await HostAsync();
        (HashSet<string> carol, HashSet<string> carolUncertain, _, _) = await SearchAsync(host.ToolsFor(Mint("carol", role: "admin")));
        (HashSet<string> alice, _, _, _) = await SearchAsync(host.ToolsFor(Mint("alice", ordersRead: true)));

        Assert.Contains("vis_role", carol);
        Assert.DoesNotContain("vis_role", carolUncertain);
        Assert.DoesNotContain("vis_role", alice);
    }

    [Fact]
    public async Task V5_ResourceOwnershipInsideHandler_VisibleButRejectedOnInvoke()
    {
        await using Harness host = await HostAsync();
        SkMcpMetaTools tools = host.ToolsFor(Mint("alice"));
        (HashSet<string> names, HashSet<string> uncertain, _, _) = await SearchAsync(tools);

        Assert.Contains("vis_mine", names);
        Assert.DoesNotContain("vis_mine", uncertain);
        Assert.Equal(200, await InvokeStatusAsync(tools, "vis_mine", new { id = 1 }));
        Assert.Equal(403, await InvokeStatusAsync(tools, "vis_mine", new { id = 2 }));
    }

    [Fact]
    public async Task V6_UndecidableRequirements_VisibleAndUncertain()
    {
        await using Harness host = await HostAsync();
        (HashSet<string> names, HashSet<string> uncertain, _, _) = await SearchAsync(host.ToolsFor(Mint("alice")));

        Assert.Contains("vis_assert", uncertain);
        Assert.Contains("vis_owner", uncertain);
        Assert.Contains("vis_filter", uncertain);
        Assert.DoesNotContain("vis_bare", uncertain);
        Assert.Subset(names, uncertain);
    }

    [Fact]
    public async Task V7_HiddenToolGuessedByName_PipelineRejects()
    {
        await using Harness host = await HostAsync();
        SkMcpMetaTools bob = host.ToolsFor(Mint("bob"));
        (HashSet<string> names, _, _, _) = await SearchAsync(bob);

        Assert.DoesNotContain("vis_claim", names);
        Assert.Equal(403, await InvokeStatusAsync(bob, "vis_claim", new { }));
        Assert.Equal(403, await InvokeStatusAsync(bob, "vis_filter", new { }));
    }

    [Fact]
    public async Task V8_VisibilityAndInvoke_ShareIdentityComposition()
    {
        await using Harness host = await HostAsync(configure: o => o.Identity.Clear());
        SkMcpMetaTools alice = host.ToolsFor(Mint("alice", ordersRead: true));
        (HashSet<string> names, _, _, _) = await SearchAsync(alice);

        Assert.DoesNotContain("vis_claim", names);
        Assert.Equal(401, await InvokeStatusAsync(alice, "vis_claim", new { }));
    }

    [Fact]
    public async Task V9_OnUnknownHide_DropsUncertainTools()
    {
        await using Harness host = await HostAsync(configure: o => o.Visibility.OnUnknown = UnknownVisibility.Hide);
        SkMcpMetaTools alice = host.ToolsFor(Mint("alice"));
        (HashSet<string> names, HashSet<string> uncertain, _, _) = await SearchAsync(alice);

        Assert.DoesNotContain("vis_assert", names);
        Assert.Empty(uncertain);
        Assert.Contains("unknown_tool", await alice.LoadTool("vis_assert"));
    }

    [Fact]
    public async Task V10_PolicyNamesNeverReachTheAgent()
    {
        await using Harness host = await HostAsync();
        SkMcpMetaTools alice = host.ToolsFor(Mint("alice", ordersRead: true, role: "admin"));
        (_, _, _, string search) = await SearchAsync(alice);
        string loaded = await alice.LoadTool("vis_claim");

        foreach (string leak in (string[])["OrdersRead", "roles:", "policies", "imperative", "Assertion"])
        {
            Assert.DoesNotContain(leak, search);
            Assert.DoesNotContain(leak, loaded);
        }
    }

    [Fact]
    public async Task V11_LoadTool_HiddenIsIndistinguishableFromMissing()
    {
        await using Harness host = await HostAsync();
        SkMcpMetaTools bob = host.ToolsFor(Mint("bob"));

        Assert.Equal(
            (await bob.LoadTool("vis_claim")).Replace("vis_claim", "x"),
            (await bob.LoadTool("does_not_exist")).Replace("does_not_exist", "x"));
        Assert.Contains("\"name\":\"vis_bare\"", await bob.LoadTool("vis_bare"));
    }

    private static Task<Harness> ProbeHostAsync(Action<SkMcpOptions>? configure = null) =>
        HostAsync(configure: o =>
        {
            o.Visibility.Tier = VisibilityTier.Probe;
            o.Identity.Forward("X-Gate");
            configure?.Invoke(o);
        });

    [Fact]
    public async Task V13_Probe_ResolvesImperativeFilterThroughMvcBackstop()
    {
        await using Harness host = await ProbeHostAsync();
        (HashSet<string> alice, HashSet<string> aliceUncertain, _, _) = await SearchAsync(host.ToolsFor(Mint("alice")));
        (HashSet<string> bob, _, _, _) = await SearchAsync(host.ToolsFor(Mint("bob")));

        Assert.Contains("vis_filter", alice);
        Assert.DoesNotContain("vis_filter", aliceUncertain);
        Assert.DoesNotContain("vis_filter", bob);
    }

    [Fact]
    public async Task V14_Probe_ResolvesUndecidableRequirementsThroughResultHandler()
    {
        await using Harness host = await ProbeHostAsync();
        (HashSet<string> names, HashSet<string> uncertain, _, _) = await SearchAsync(host.ToolsFor(Mint("alice")));

        Assert.Contains("vis_assert", names);
        Assert.DoesNotContain("vis_assert", uncertain);
        Assert.Contains("vis_owner", names);
        Assert.DoesNotContain("vis_owner", uncertain);
    }

    [Fact]
    public async Task V15_Probe_HasNoSideEffects()
    {
        await using Harness host = await ProbeHostAsync();
        SkMcpMetaTools alice = host.ToolsFor(Mint("alice"));
        int before = VisibilityController.SideEffects;

        (HashSet<string> names, HashSet<string> uncertain, _, _) = await SearchAsync(alice, "effect");
        Assert.Contains("vis_effect", names);
        Assert.DoesNotContain("vis_effect", uncertain);
        Assert.Equal(before, VisibilityController.SideEffects);

        Assert.Equal(200, await InvokeStatusAsync(alice, "vis_effect", new { }));
        Assert.Equal(before + 1, VisibilityController.SideEffects);
    }

    [Fact]
    public async Task V16_Probe_SkipsUnsafeNonMvcEndpoints()
    {
        await using Harness host = await ProbeHostAsync();
        (HashSet<string> names, HashSet<string> uncertain, _, _) = await SearchAsync(host.ToolsFor(Mint("alice")));

        Assert.Contains("post_vis_minimal_post", names);
        Assert.Contains("post_vis_minimal_post", uncertain);
    }

    [Fact]
    public async Task V17_ProbeFlag_CannotBeSetByRealRequests()
    {
        await using Harness host = await ProbeHostAsync();
        using HttpClient client = host.App.GetTestClient();
        using HttpRequestMessage request = new(System.Net.Http.HttpMethod.Get, "/vis/probeflag");
        request.Headers.TryAddWithoutValidation("sk-mcp.probe", "true");
        request.Headers.TryAddWithoutValidation("X-SkMcp-Probe", "1");
        request.Headers.TryAddWithoutValidation("sk-mcp.synthetic", "true");
        request.Headers.TryAddWithoutValidation("User-Agent", "sk-mcp/9.9.9");

        HttpResponseMessage response = await client.SendAsync(request);
        string body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"probe\":false", body);
        Assert.Contains("\"synthetic\":false", body);
    }

    [Fact]
    public async Task V22_UndeclaredEndpoint_IsUnknownNotAnonymous()
    {
        await using Harness host = await HostAsync();
        (HashSet<string> names, HashSet<string> uncertain, _, _) = await SearchAsync(host.ToolsFor(Mint("alice")));
        (HashSet<string> anonymous, HashSet<string> anonymousUncertain, _, _) = await SearchAsync(host.ToolsFor(null));

        Assert.Contains("vis_undeclared", names);
        Assert.Contains("vis_undeclared", uncertain);
        Assert.Contains("vis_undeclared", anonymous);
        Assert.Contains("vis_undeclared", anonymousUncertain);
        Assert.Contains("vis_anon", names);
        Assert.DoesNotContain("vis_anon", uncertain);
    }

    [Fact]
    public async Task V23_Probe_ResolvesUndeclaredEndpointFromMiddlewareVerdict()
    {
        await using Harness host = await ProbeHostAsync();
        (HashSet<string> identified, HashSet<string> identifiedUncertain, _, _) =
            await SearchAsync(host.ToolsFor(Mint("alice")));
        (HashSet<string> anonymous, _, _, _) = await SearchAsync(host.ToolsFor(null));

        Assert.Contains("vis_undeclared", identified);
        Assert.DoesNotContain("vis_undeclared", identifiedUncertain);
        Assert.DoesNotContain("vis_undeclared", anonymous);
    }

    [Fact]
    public async Task V21_Transport_ForwardsBearerOfEachSession()
    {
        await using Harness host = await HostAsync();
        string aliceToken = Mint("alice", ordersRead: true);
        string bobToken = Mint("bob");
        (HashSet<string> aliceExpected, _, _, _) = await SearchAsync(host.ToolsFor(aliceToken));
        (HashSet<string> bobExpected, _, _, _) = await SearchAsync(host.ToolsFor(bobToken));

        HashSet<string> alice = await SearchOverTransportAsync(host, aliceToken);
        HashSet<string> bob = await SearchOverTransportAsync(host, bobToken);

        Assert.Equal(aliceExpected, alice);
        Assert.Equal(bobExpected, bob);
        Assert.NotEqual(alice, bob);
    }

    private static async Task<HashSet<string>> SearchOverTransportAsync(Harness host, string token)
    {
        using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(30));
        using HttpClient http = host.App.GetTestClient();
        await using HttpClientTransport transport = new(
            new HttpClientTransportOptions
            {
                Endpoint = new Uri(http.BaseAddress!, "/mcp"),
                TransportMode = HttpTransportMode.StreamableHttp,
                EnableStandaloneGetStream = false,
                AdditionalHeaders = new Dictionary<string, string> { ["Authorization"] = $"Bearer {token}" },
            },
            http);
        await using McpClient client = await McpClient.CreateAsync(transport, cancellationToken: timeout.Token);

        CallToolResult result = await client.CallToolAsync(
            "search_tools",
            new Dictionary<string, object?> { ["query"] = "", ["limit"] = SkMcpMetaTools.MaxLimit },
            cancellationToken: timeout.Token);

        string raw = Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text;
        using JsonDocument document = JsonDocument.Parse(raw);
        return document.RootElement.GetProperty("results").EnumerateArray()
            .Select(card => card.GetProperty("name").GetString()!)
            .ToHashSet(StringComparer.Ordinal);
    }

    [Fact]
    public async Task V18_Probe_ReadsCustomMiddlewareVerdictWithoutMarker()
    {
        await using Harness host = await ProbeHostAsync();
        (HashSet<string> closed, _, _, _) = await SearchAsync(host.ToolsFor(Mint("bob")));
        (HashSet<string> open, HashSet<string> openUncertain, _, _) =
            await SearchAsync(host.ToolsFor(Mint("bob"), ("X-Gate", "open")));

        Assert.DoesNotContain("vis_gated", closed);
        Assert.Contains("vis_gated", open);
        Assert.DoesNotContain("vis_gated", openUncertain);
    }

    [Fact]
    public async Task V19_ProbeBudgetZero_LeavesEverythingUncertain()
    {
        await using Harness host = await ProbeHostAsync(o => o.Visibility.ProbeTopK = 0);
        (HashSet<string> names, HashSet<string> uncertain, _, _) = await SearchAsync(host.ToolsFor(Mint("alice")));

        Assert.Contains("vis_assert", names);
        Assert.Contains("vis_assert", uncertain);
        Assert.Contains("vis_filter", uncertain);
    }

    [Fact]
    public async Task V12_NoAuthenticationScheme_IdentityUnknown_EverythingUncertainNotHidden()
    {
        await using Harness host = await HostAsync(authentication: false);
        (HashSet<string> names, HashSet<string> uncertain, _, _) = await SearchAsync(host.ToolsFor(Mint("alice", ordersRead: true)));

        Assert.Contains("vis_bare", uncertain);
        Assert.Contains("vis_claim", uncertain);
        Assert.Contains("vis_anon", names);
        Assert.DoesNotContain("vis_anon", uncertain);
    }
}
