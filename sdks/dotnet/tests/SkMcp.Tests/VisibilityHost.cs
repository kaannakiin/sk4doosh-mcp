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
using ModelContextProtocol.Protocol;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Caching;
using SkMcp.AspNetCore.Discovery;
using SkMcp.AspNetCore.Errors;
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
    public static int UndeclaredHits;

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

    [HttpGet("dynamic")]
    [DynamicGrant]
    public IActionResult VisDynamic() => Ok();

    [HttpGet("regex/{code:regex(^zzz$)}")]
    [Authorize(Policy = "Assertion")]
    public IActionResult VisRegex(string code) => Ok();
}

internal sealed class FixedContext(HttpContext context) : IHttpContextAccessor
{
    public HttpContext? HttpContext { get => context; set { } }
}

internal sealed record Harness(WebApplication App, SkMcpDispatcher Dispatcher) : IAsyncDisposable
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
            App.Services.GetRequiredService<IInvokeResultMapper>(),
            App.Services.GetRequiredService<CallerVisibilityProvider>(),
            App.Services.GetRequiredService<ICallerScopeResolver>(),
            App.Services.GetRequiredService<IOptions<SkMcpOptions>>(),
            new FixedContext(outer));
    }

    public async ValueTask DisposeAsync()
    {
        await App.StopAsync();
        await App.DisposeAsync();
    }
}

internal static class VisibilityHost
{
    public static string Mint(string name, bool ordersRead = false, string? role = null)
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

    public static async Task<Harness> HostAsync(
        bool authentication = true,
        Action<SkMcpOptions>? configure = null,
        Action<IServiceCollection>? beforeSkMcp = null,
        Action<IServiceCollection>? afterSkMcp = null)
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddControllers().AddApplicationPart(typeof(VisibilityHost).Assembly);
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
        beforeSkMcp?.Invoke(builder.Services);
        builder.Services.AddSkMcp(configure);
        afterSkMcp?.Invoke(builder.Services);

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
            if (context.Request.Path.StartsWithSegments("/vis/undeclared"))
            {
                Interlocked.Increment(ref VisibilityController.UndeclaredHits);
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

    public static Task<Harness> ProbeHostAsync(
        Action<SkMcpOptions>? configure = null,
        Action<IServiceCollection>? beforeSkMcp = null,
        Action<IServiceCollection>? afterSkMcp = null) =>
        HostAsync(
            configure: o =>
            {
                o.Visibility.Tier = VisibilityTier.Probe;
                o.Identity.Forward("X-Gate");
                configure?.Invoke(o);
            },
            beforeSkMcp: beforeSkMcp,
            afterSkMcp: afterSkMcp);

    public static async Task<(HashSet<string> Names, HashSet<string> Uncertain, int Total, string Raw)> SearchAsync(
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

    public static string TextOf(CallToolResult result) => ((TextContentBlock)result.Content[0]).Text;

    public static async Task<int> InvokeStatusAsync(SkMcpMetaTools tools, string name, object arguments)
    {
        CallToolResult result = await tools.InvokeTool(name, JsonSerializer.SerializeToElement(arguments), CancellationToken.None);
        string raw = TextOf(result);
        using JsonDocument document = JsonDocument.Parse(raw);
        return document.RootElement.TryGetProperty("status", out JsonElement status)
            ? status.GetInt32()
            : throw new Xunit.Sdk.XunitException(raw);
    }
}
