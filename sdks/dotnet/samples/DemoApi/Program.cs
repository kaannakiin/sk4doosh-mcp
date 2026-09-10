using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using ModelContextProtocol.Authentication;
using SkMcp.AspNetCore;
using SkMcp.AspNetCore.Discovery;
using SkMcp.Samples.DemoAuthServer;

const string McpResource = "http://127.0.0.1:5178/mcp";
const string Issuer = "http://127.0.0.1:5178/oauth";

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpContextAccessor();

DemoAuthServer authServer = new(new DemoAuthServerOptions
{
    Issuer = new Uri(Issuer),
    DefaultAudience = new Uri(McpResource),
});
builder.Services.AddSingleton(authServer);

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.RequireHttpsMetadata = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = Issuer,
            ValidateAudience = true,
            ValidAudience = McpResource,
            IssuerSigningKey = authServer.PublicKey,
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("OrdersRead", policy => policy.RequireClaim("orders.read", "true"));
    options.AddPolicy("BusinessHours", policy => policy.RequireAssertion(_ => DateTime.UtcNow.Hour is >= 6 and < 22));
});

builder.Services.AddSkMcp(options =>
{
    options.Visibility.Tier = VisibilityTier.Probe;
    options.ResourceServer.Metadata = new ProtectedResourceMetadata
    {
        Resource = McpResource,
        AuthorizationServers = { Issuer },
        BearerMethodsSupported = ["header"],
        ResourceName = "DemoApi",
    };
});

var app = builder.Build();

app.UseSkMcpCapture();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }))
    .AllowAnonymous()
    .WithMetadata(new McpToolAttribute(), new EndpointDescriptionAttribute("Service health status; requires no identity."));
app.MapDemoAuthorizationServer(authServer);
app.MapSkMcp("/mcp").RequireAuthorization();

app.MapPost("/auth/token", (TokenRequest request) =>
{
    if (request.User is not ("alice" or "bob" or "carol"))
    {
        return Results.BadRequest(new { error = "unknown user (use alice, bob or carol)" });
    }
    string accessToken = authServer.IssueAccessToken(request.User, new Uri(McpResource), scope: null);
    return Results.Ok(new { access_token = accessToken });
});

app.Run();

internal sealed record TokenRequest(string User);
