using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using SkMcp.AspNetCore;

namespace SkMcp.Tests;

internal sealed record TestApp(WebApplication App, HttpClient Client, SkMcpDispatcher Dispatcher) : IAsyncDisposable
{
    public async ValueTask DisposeAsync()
    {
        await App.StopAsync();
        await App.DisposeAsync();
    }
}

internal static class Hosts
{
    public const string SigningKey = "sk-mcp-tests-signing-key-at-least-32-bytes-long!!";

    public static string MintToken(string name, bool ordersRead, bool expired = false)
    {
        List<Claim> claims = [new(ClaimTypes.Name, name)];
        if (ordersRead)
        {
            claims.Add(new Claim("orders.read", "true"));
        }
        DateTime now = DateTime.UtcNow;
        JsonWebTokenHandler handler = new();
        return handler.CreateToken(new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            IssuedAt = expired ? now.AddMinutes(-10) : now,
            NotBefore = expired ? now.AddMinutes(-10) : now,
            Expires = expired ? now.AddMinutes(-5) : now.AddHours(1),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningKey)),
                SecurityAlgorithms.HmacSha256),
        });
    }

    public static async Task<TestApp> JwtAppAsync()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(o =>
            {
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningKey)),
                    ClockSkew = TimeSpan.Zero,
                };
            });
        builder.Services.AddAuthorization(o =>
            o.AddPolicy("OrdersRead", p => p.RequireClaim("orders.read", "true")));
        builder.Services.AddSkMcp();

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapGet("/orders/{id:int}", (int id) => Results.Ok(new { id }))
            .RequireAuthorization("OrdersRead");
        app.MapGet("/me", (ClaimsPrincipal user) => user.Identity!.Name!)
            .RequireAuthorization();
        app.MapGet("/echo-auth", (HttpRequest r) =>
            r.Headers.ContainsKey("Authorization") ? "present" : "absent");
        await app.StartAsync();
        return new TestApp(app, app.GetTestClient(), app.Services.GetRequiredService<SkMcpDispatcher>());
    }

    public static async Task<TestApp> GateAppAsync(
        Action<SkMcpOptions>? configure, Func<HttpContext, bool> gate)
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp(configure);

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.Use(async (ctx, next) =>
        {
            if (!gate(ctx))
            {
                ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
            await next();
        });
        app.MapGet("/secure", () => "ok");
        await app.StartAsync();
        return new TestApp(app, app.GetTestClient(), app.Services.GetRequiredService<SkMcpDispatcher>());
    }

    public static HttpRequest Outer(params (string Name, string Value)[] headers)
    {
        DefaultHttpContext ctx = new();
        foreach ((string name, string value) in headers)
        {
            ctx.Request.Headers[name] = value;
        }
        return ctx.Request;
    }
}

public class IdentityCarrierTests
{
    [Theory]
    [InlineData(true, true, 200)]
    [InlineData(true, false, 403)]
    public async Task S1_ValidToken_MatchesDirectHttp(bool valid, bool ordersRead, int expected)
    {
        _ = valid;
        await using TestApp app = await Hosts.JwtAppAsync();
        string token = Hosts.MintToken("user", ordersRead);

        using HttpRequestMessage control = new(System.Net.Http.HttpMethod.Get, "/orders/1");
        control.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
        HttpResponseMessage direct = await app.Client.SendAsync(control);

        DispatchResult dispatched = await app.Dispatcher.DispatchAsync(
            System.Net.Http.HttpMethod.Get, "/orders/1",
            Hosts.Outer(("Authorization", $"Bearer {token}")), CancellationToken.None);

        Assert.Equal(expected, (int)direct.StatusCode);
        Assert.Equal(expected, dispatched.Status);
    }

    [Theory]
    [InlineData("Bearer not-a-jwt")]
    [InlineData(null)]
    public async Task S1_BadOrMissingToken_401(string? authorization)
    {
        await using TestApp app = await Hosts.JwtAppAsync();
        HttpRequest outer = authorization is null
            ? Hosts.Outer()
            : Hosts.Outer(("Authorization", authorization));

        DispatchResult dispatched = await app.Dispatcher.DispatchAsync(
            System.Net.Http.HttpMethod.Get, "/orders/1", outer, CancellationToken.None);

        Assert.Equal(401, dispatched.Status);
    }

    [Fact]
    public async Task S2_UndeclaredCookie_DoesNotForward()
    {
        await using TestApp app = await Hosts.GateAppAsync(
            null, ctx => ctx.Request.Cookies["sid"] == "ok");

        using HttpRequestMessage control = new(System.Net.Http.HttpMethod.Get, "/secure");
        control.Headers.TryAddWithoutValidation("Cookie", "sid=ok");
        HttpResponseMessage direct = await app.Client.SendAsync(control);

        DispatchResult dispatched = await app.Dispatcher.DispatchAsync(
            System.Net.Http.HttpMethod.Get, "/secure",
            Hosts.Outer(("Cookie", "sid=ok")), CancellationToken.None);

        Assert.Equal(200, (int)direct.StatusCode);
        Assert.Equal(401, dispatched.Status);
    }

    [Fact]
    public async Task S3_DeclaredCookie_Forwards()
    {
        await using TestApp app = await Hosts.GateAppAsync(
            o => o.Identity.Forward("Cookie"), ctx => ctx.Request.Cookies["sid"] == "ok");

        DispatchResult dispatched = await app.Dispatcher.DispatchAsync(
            System.Net.Http.HttpMethod.Get, "/secure",
            Hosts.Outer(("Cookie", "sid=ok")), CancellationToken.None);

        Assert.Equal(200, dispatched.Status);
    }

    [Theory]
    [InlineData(true, 200)]
    [InlineData(false, 401)]
    public async Task S4_CustomHeaderCarrier(bool declared, int expected)
    {
        await using TestApp app = await Hosts.GateAppAsync(
            declared ? o => o.Identity.Forward("X-Api-Key") : null,
            ctx => ctx.Request.Headers["X-Api-Key"] == "k1");

        DispatchResult dispatched = await app.Dispatcher.DispatchAsync(
            System.Net.Http.HttpMethod.Get, "/secure",
            Hosts.Outer(("X-Api-Key", "k1")), CancellationToken.None);

        Assert.Equal(expected, dispatched.Status);
    }

    [Fact]
    public async Task S5_ProjectDelegate_ComposesCarriers()
    {
        await using TestApp app = await Hosts.GateAppAsync(
            o => o.Identity.Clear().Project((outer, synthetic) =>
                synthetic.Headers["X-Auth"] = $"{outer.Headers["A-Part"]}|{outer.Headers["B-Part"]}"),
            ctx => ctx.Request.Headers["X-Auth"] == "a|b");

        DispatchResult dispatched = await app.Dispatcher.DispatchAsync(
            System.Net.Http.HttpMethod.Get, "/secure",
            Hosts.Outer(("A-Part", "a"), ("B-Part", "b")), CancellationToken.None);

        Assert.Equal(200, dispatched.Status);
    }

    [Fact]
    public async Task S6_AbsentCarrier_NeverFabricated()
    {
        await using TestApp app = await Hosts.JwtAppAsync();

        DispatchResult without = await app.Dispatcher.DispatchAsync(
            System.Net.Http.HttpMethod.Get, "/echo-auth", Hosts.Outer(), CancellationToken.None);
        DispatchResult with = await app.Dispatcher.DispatchAsync(
            System.Net.Http.HttpMethod.Get, "/echo-auth",
            Hosts.Outer(("Authorization", "Bearer x")), CancellationToken.None);

        Assert.Equal("absent", without.Body);
        Assert.Equal("present", with.Body);
    }

    [Theory]
    [InlineData(true, 200)]
    [InlineData(false, 401)]
    public async Task S7_CsrfPairPolicy_IsUsersDecision(bool forwardCsrfHeader, int expected)
    {
        Action<SkMcpOptions> configure = forwardCsrfHeader
            ? o => o.Identity.Forward("Cookie").Forward("X-CSRF-Token")
            : o => o.Identity.Forward("Cookie");
        await using TestApp app = await Hosts.GateAppAsync(
            configure,
            ctx => ctx.Request.Cookies["sid"] == "ok" && ctx.Request.Headers["X-CSRF-Token"] == "t1");

        DispatchResult dispatched = await app.Dispatcher.DispatchAsync(
            System.Net.Http.HttpMethod.Get, "/secure",
            Hosts.Outer(("Cookie", "sid=ok"), ("X-CSRF-Token", "t1")), CancellationToken.None);

        Assert.Equal(expected, dispatched.Status);
    }

    [Fact]
    public async Task S8_ExpiredToken_RevalidationCatches()
    {
        await using TestApp app = await Hosts.JwtAppAsync();
        string token = Hosts.MintToken("user", ordersRead: true, expired: true);

        DispatchResult dispatched = await app.Dispatcher.DispatchAsync(
            System.Net.Http.HttpMethod.Get, "/orders/1",
            Hosts.Outer(("Authorization", $"Bearer {token}")), CancellationToken.None);

        Assert.Equal(401, dispatched.Status);
    }

    [Fact]
    public async Task S9_ParallelDispatch_NoIdentityBleed()
    {
        await using TestApp app = await Hosts.JwtAppAsync();
        string aliceToken = Hosts.MintToken("alice", ordersRead: true);
        string bobToken = Hosts.MintToken("bob", ordersRead: true);

        IEnumerable<Task<(string Expected, DispatchResult Result)>> work = Enumerable.Range(0, 50).Select(async i =>
        {
            (string name, string token) = i % 2 == 0 ? ("alice", aliceToken) : ("bob", bobToken);
            DispatchResult result = await app.Dispatcher.DispatchAsync(
                System.Net.Http.HttpMethod.Get, "/me",
                Hosts.Outer(("Authorization", $"Bearer {token}")), CancellationToken.None);
            return (name, result);
        });

        foreach ((string expected, DispatchResult result) in await Task.WhenAll(work))
        {
            Assert.Equal(200, result.Status);
            Assert.Equal(expected, result.Body);
        }
    }
}
