using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using ModelContextProtocol;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.AspNetCore.Authentication;
using ModelContextProtocol.Authentication;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using SkMcp.AspNetCore;
using SkMcp.Samples.DemoAuthServer;

namespace SkMcp.Tests;

internal sealed record TransportApp(WebApplication App, DemoAuthServer AuthServer, string Pattern) : IAsyncDisposable
{
    public HttpClient Client => App.GetTestClient();

    public async ValueTask DisposeAsync()
    {
        await App.StopAsync();
        await App.DisposeAsync();
    }
}

public sealed class TransportTests
{
    private const string LegacyProtocolVersion = "2025-11-25";

    private const string GenerationMetaKey = "sk-mcp/catalogGeneration";

    private static async Task<TransportApp> HostAsync(
        Action<SkMcpOptions>? configureSkMcp = null,
        Action<IServiceCollection>? configureServices = null,
        bool requireAuthorization = true,
        bool configureResourceServer = true,
        string pattern = "/mcp")
    {
        string resource = "http://localhost" + pattern;

        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        DemoAuthServer authServer = new(new DemoAuthServerOptions
        {
            Issuer = new Uri("http://localhost/oauth"),
            DefaultAudience = new Uri(resource),
        });

        builder.Services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(o =>
            {
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = authServer.Issuer.ToString(),
                    ValidateAudience = true,
                    ValidAudience = resource,
                    IssuerSigningKey = authServer.PublicKey,
                };
            });
        builder.Services.AddAuthorization();

        configureServices?.Invoke(builder.Services);

        builder.Services.AddSkMcp(o =>
        {
            if (configureResourceServer)
            {
                o.ResourceServer.Metadata = new ProtectedResourceMetadata
                {
                    Resource = resource,
                    AuthorizationServers = { authServer.Issuer.ToString() },
                    BearerMethodsSupported = ["header"],
                };
            }
            configureSkMcp?.Invoke(o);
        });

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapDemoAuthorizationServer(authServer);

        IEndpointConventionBuilder mapped = app.MapSkMcp(pattern);
        if (requireAuthorization)
        {
            mapped.RequireAuthorization();
        }

        await app.StartAsync();
        return new TransportApp(app, authServer, pattern);
    }

    private static async Task<McpClient> ConnectAsync(
        TransportApp app, string? bearerToken, Action<HttpClientTransportOptions>? configureTransport = null)
    {
        HttpClientTransportOptions options = new()
        {
            Endpoint = new Uri("http://localhost" + app.Pattern),
            Name = "sk-mcp-transport-tests",
        };
        if (bearerToken is not null)
        {
            options.AdditionalHeaders = new Dictionary<string, string> { ["Authorization"] = $"Bearer {bearerToken}" };
        }
        configureTransport?.Invoke(options);

        HttpClientTransport transport = new(options, app.Client, loggerFactory: null, ownsHttpClient: false);
        McpClientOptions clientOptions = new() { ProtocolVersion = LegacyProtocolVersion };
        return await McpClient.CreateAsync(transport, clientOptions, cancellationToken: CancellationToken.None);
    }

    private static int CountOccurrences(IEnumerable<string> values, string needle) =>
        values.Sum(value => (value.Length - value.Replace(needle, string.Empty).Length) / needle.Length);

    [Fact]
    public async Task T1_ProtectedResourceMetadata_ServedAnonymously_WithRfc9728Shape()
    {
        await using TransportApp app = await HostAsync();

        HttpResponseMessage response = await app.Client.GetAsync("/.well-known/oauth-protected-resource/mcp");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.StartsWith("application/json", response.Content.Headers.ContentType?.MediaType ?? string.Empty, StringComparison.Ordinal);
        Assert.Equal("public, max-age=300", response.Headers.CacheControl?.ToString());

        using JsonDocument document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("http://localhost/mcp", document.RootElement.GetProperty("resource").GetString());
        JsonElement servers = document.RootElement.GetProperty("authorization_servers");
        Assert.Equal("http://localhost/oauth", servers[0].GetString());
    }

    [Fact]
    public async Task T2_MissingBearer_401_ChallengeCarriesResourceMetadata()
    {
        await using TransportApp app = await HostAsync();

        HttpResponseMessage response = await app.Client.PostAsync("/mcp", content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        string[] values = [.. response.Headers.WwwAuthenticate.Select(h => h.ToString())];
        Assert.Single(values);
        Assert.Contains("resource_metadata=\"http://localhost/.well-known/oauth-protected-resource/mcp\"", values[0], StringComparison.Ordinal);
    }

    [Fact]
    public async Task T3_InvalidToken_401_ResourceMetadataMergedIntoJwtBearerChallenge()
    {
        await using TransportApp app = await HostAsync();

        using HttpRequestMessage request = new(HttpMethod.Post, "/mcp");
        request.Headers.TryAddWithoutValidation("Authorization", "Bearer not-a-real-jwt");
        HttpResponseMessage response = await app.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        string[] values = [.. response.Headers.WwwAuthenticate.Select(h => h.ToString())];
        Assert.Single(values);
        Assert.Contains("error=\"invalid_token\"", values[0], StringComparison.Ordinal);
        Assert.Contains("resource_metadata=", values[0], StringComparison.Ordinal);
    }

    [Fact]
    public async Task T4_WrongAudienceToken_Rejected()
    {
        await using TransportApp app = await HostAsync();
        string token = app.AuthServer.IssueAccessToken("alice", new Uri("http://localhost/other-resource"), scope: null);

        using HttpRequestMessage request = new(HttpMethod.Post, "/mcp");
        request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
        HttpResponseMessage response = await app.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task T5_OAuthFlow_Dcr_Pkce_Authorize_Token_ThenSearchTools()
    {
        await using TransportApp app = await HostAsync();

        Func<AuthorizationCallbackContext, CancellationToken, Task<AuthorizationResult?>> callbackHandler =
            async (context, cancellationToken) =>
            {
                HttpResponseMessage authorizeResponse = await app.Client.GetAsync(context.AuthorizationUri, cancellationToken);
                if (authorizeResponse.StatusCode is not (HttpStatusCode.Redirect or HttpStatusCode.Found))
                {
                    string body = await authorizeResponse.Content.ReadAsStringAsync(cancellationToken);
                    throw new InvalidOperationException(
                        $"authorize endpoint returned {(int)authorizeResponse.StatusCode}: {body}");
                }
                Uri location = authorizeResponse.Headers.Location
                    ?? throw new InvalidOperationException("authorize endpoint did not return a Location header.");
                Dictionary<string, StringValues> query = QueryHelpers.ParseQuery(location.Query);
                return new AuthorizationResult
                {
                    Code = query.TryGetValue("code", out StringValues code) ? code.ToString() : null,
                    State = query.TryGetValue("state", out StringValues state) ? state.ToString() : null,
                };
            };

        McpClient client = await ConnectAsync(app, bearerToken: null, options =>
        {
            options.OAuth = new ClientOAuthOptions
            {
                RedirectUri = new Uri("http://localhost/callback"),
                DynamicClientRegistration = new DynamicClientRegistrationOptions { ClientName = "sk-mcp-tests" },
                AuthorizationCallbackHandler = callbackHandler,
            };
        });
        await using (client)
        {
            CallToolResult result = await client.CallToolAsync("search_tools", cancellationToken: CancellationToken.None);
            Assert.NotEqual(true, result.IsError);
        }
    }

    [Fact]
    public void T6_IssuedToken_AudienceEqualsMcpResource()
    {
        DemoAuthServer authServer = new(new DemoAuthServerOptions
        {
            Issuer = new Uri("http://localhost/oauth"),
            DefaultAudience = new Uri("http://localhost/mcp"),
        });

        string token = authServer.IssueAccessToken("alice", new Uri("http://localhost/mcp"), scope: null);
        JsonWebToken parsed = new JsonWebTokenHandler().ReadJsonWebToken(token);

        Assert.Contains("http://localhost/mcp", parsed.Audiences);
    }

    [Fact]
    public async Task T7_CustomMiddlewareHost_401BodyPreserved_ChallengeAdded_PrmServedBeforeAuth()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        builder.Services.AddSkMcp(o => o.ResourceServer.Metadata = new ProtectedResourceMetadata
        {
            Resource = "http://localhost/mcp",
            AuthorizationServers = { "http://localhost/oauth" },
        });

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.Use(async (context, next) =>
        {
            if (!context.Request.Headers.ContainsKey("Authorization"))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync("""{"error":"Unauthorized"}""");
                return;
            }
            await next();
        });
        app.MapSkMcp("/mcp");
        await app.StartAsync();
        await using WebApplication _ = app;

        HttpClient client = app.GetTestClient();

        HttpResponseMessage prm = await client.GetAsync("/.well-known/oauth-protected-resource/mcp");
        Assert.Equal(HttpStatusCode.OK, prm.StatusCode);

        HttpResponseMessage denied = await client.PostAsync("/mcp", content: null);
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
        Assert.Equal("""{"error":"Unauthorized"}""", await denied.Content.ReadAsStringAsync());
        string[] values = [.. denied.Headers.WwwAuthenticate.Select(h => h.ToString())];
        Assert.Single(values);
        Assert.Contains("resource_metadata=", values[0], StringComparison.Ordinal);
    }

    [Fact]
    public async Task T8_ResourceServerNotConfigured_NoPrm_NoDecoration()
    {
        await using TransportApp app = await HostAsync(configureResourceServer: false);

        HttpResponseMessage prm = await app.Client.GetAsync("/.well-known/oauth-protected-resource/mcp");
        Assert.Equal(HttpStatusCode.NotFound, prm.StatusCode);

        HttpResponseMessage denied = await app.Client.PostAsync("/mcp", content: null);
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);
        string[] values = [.. denied.Headers.WwwAuthenticate.Select(h => h.ToString())];
        Assert.DoesNotContain(values, v => v.Contains("resource_metadata", StringComparison.Ordinal));
    }

    [Fact]
    public async Task T9_ListChanged_StatefulSession_NotifiedAfterCatalogChange()
    {
        await using TransportApp app = await HostAsync(configureServices: services =>
            services.Configure<HttpServerTransportOptions>(o => o.SessionMode = HttpServerSessionMode.Stateful));
        string token = app.AuthServer.IssueAccessToken("alice", new Uri("http://localhost/mcp"), scope: null);

        McpClient client = await ConnectAsync(app, token);
        await using (client)
        {
            TaskCompletionSource<bool> notified = new(TaskCreationOptions.RunContinuationsAsynchronously);
            await using IAsyncDisposable subscription = client.RegisterNotificationHandler(
                NotificationMethods.ToolListChangedNotification,
                (_, _) =>
                {
                    notified.TrySetResult(true);
                    return ValueTask.CompletedTask;
                });

            await app.App.Services.GetRequiredService<SkMcpCatalogProvider>().ReloadAsync();

            Task completed = await Task.WhenAny(notified.Task, Task.Delay(TimeSpan.FromSeconds(10)));
            Assert.Same(notified.Task, completed);
        }
    }

    [Fact]
    public async Task T10_ListChanged_Stateless_NoNotification_NoError()
    {
        await using TransportApp app = await HostAsync();
        string token = app.AuthServer.IssueAccessToken("alice", new Uri("http://localhost/mcp"), scope: null);

        McpClient client = await ConnectAsync(app, token);
        await using (client)
        {
            TaskCompletionSource<bool> notified = new(TaskCreationOptions.RunContinuationsAsynchronously);
            await using IAsyncDisposable subscription = client.RegisterNotificationHandler(
                NotificationMethods.ToolListChangedNotification,
                (_, _) =>
                {
                    notified.TrySetResult(true);
                    return ValueTask.CompletedTask;
                });

            await app.App.Services.GetRequiredService<SkMcpCatalogProvider>().ReloadAsync();
            await Task.WhenAny(notified.Task, Task.Delay(TimeSpan.FromMilliseconds(500)));
            Assert.False(notified.Task.IsCompleted);

            CallToolResult result = await client.CallToolAsync("search_tools", cancellationToken: CancellationToken.None);
            Assert.NotEqual(true, result.IsError);
        }
    }

    [Fact]
    public async Task T11_Initialize_AdvertisesToolsListChanged()
    {
        await using TransportApp app = await HostAsync(configureServices: services =>
            services.Configure<HttpServerTransportOptions>(o => o.SessionMode = HttpServerSessionMode.Stateful));
        string token = app.AuthServer.IssueAccessToken("alice", new Uri("http://localhost/mcp"), scope: null);

        McpClient client = await ConnectAsync(app, token);
        await using (client)
        {
            Assert.True(client.ServerCapabilities.Tools?.ListChanged);
        }
    }

    [Fact]
    public async Task T12_ToolsList_MetaCarriesCatalogGeneration_AfterChange()
    {
        await using TransportApp app = await HostAsync();
        string token = app.AuthServer.IssueAccessToken("alice", new Uri("http://localhost/mcp"), scope: null);

        McpClient client = await ConnectAsync(app, token);
        await using (client)
        {
            IList<McpClientTool> before = await client.ListToolsAsync(cancellationToken: CancellationToken.None);
            long generationBefore = before[0].ProtocolTool.Meta?[GenerationMetaKey]?.GetValue<long>()
                ?? throw new InvalidOperationException("Missing sk-mcp/catalogGeneration meta.");

            await app.App.Services.GetRequiredService<SkMcpCatalogProvider>().ReloadAsync();

            IList<McpClientTool> after = await client.ListToolsAsync(cancellationToken: CancellationToken.None);
            long generationAfter = after[0].ProtocolTool.Meta?[GenerationMetaKey]?.GetValue<long>()
                ?? throw new InvalidOperationException("Missing sk-mcp/catalogGeneration meta.");

            Assert.True(generationAfter > generationBefore);
        }
    }

    [Fact]
    public async Task T13_HostUsingSdkAddMcpHandler_NoDuplicateResourceMetadata()
    {
        string resource = "http://localhost/mcp";

        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        DemoAuthServer authServer = new(new DemoAuthServerOptions
        {
            Issuer = new Uri("http://localhost/oauth"),
            DefaultAudience = new Uri(resource),
        });

        builder.Services.AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = McpAuthenticationDefaults.AuthenticationScheme;
            })
            .AddJwtBearer(o =>
            {
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = authServer.Issuer.ToString(),
                    ValidateAudience = true,
                    ValidAudience = resource,
                    IssuerSigningKey = authServer.PublicKey,
                };
            })
            .AddMcp(o => o.ResourceMetadata = new ProtectedResourceMetadata
            {
                Resource = resource,
                AuthorizationServers = { authServer.Issuer.ToString() },
            });
        builder.Services.AddAuthorization();

        builder.Services.AddSkMcp(o => o.ResourceServer.Metadata = new ProtectedResourceMetadata
        {
            Resource = resource,
            AuthorizationServers = { authServer.Issuer.ToString() },
        });

        WebApplication app = builder.Build();
        app.UseSkMcpCapture();
        app.UseRouting();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapSkMcp("/mcp").RequireAuthorization();
        await app.StartAsync();
        await using WebApplication _ = app;

        HttpResponseMessage response = await app.GetTestClient().PostAsync("/mcp", content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        IEnumerable<string> values = response.Headers.TryGetValues("WWW-Authenticate", out IEnumerable<string>? raw)
            ? raw
            : [];
        Assert.Equal(1, CountOccurrences(values, "resource_metadata"));
    }

    [Fact]
    public async Task T14_MapSkMcp_RequireAuthorization_BlocksAnonymousInitialize()
    {
        await using TransportApp app = await HostAsync();

        using HttpRequestMessage request = new(HttpMethod.Post, "/mcp")
        {
            Content = new StringContent(
                """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"anon","version":"1.0"}}}""",
                System.Text.Encoding.UTF8, "application/json"),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

        HttpResponseMessage response = await app.Client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task T15_ResourceServerOptions_WithoutResource_FailsValidation()
    {
        await Assert.ThrowsAsync<OptionsValidationException>(() => HostAsync(
            configureResourceServer: false,
            configureSkMcp: o => o.ResourceServer.Metadata = new ProtectedResourceMetadata
            {
                AuthorizationServers = { "http://localhost/oauth" },
            }));
    }
}
