using System.Security.Claims;
using DemoApi.Mcp;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using SkMcp.AspNetCore;
using System.Text;

const string DemoSigningKey = "sk-mcp-demo-signing-key-do-not-use-in-production!!";

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddHttpContextAccessor();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.RequireHttpsMetadata = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = false,
            ValidateAudience = false,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(DemoSigningKey)),
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("OrdersRead", policy => policy.RequireClaim("orders.read", "true"));
});

builder.Services.AddSkMcp();

builder.Services.AddMcpServer()
    .WithHttpTransport()
    .WithTools<OrderTools>();

var app = builder.Build();

app.UseSkMcpCapture();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapMcp("/mcp");

app.MapPost("/auth/token", (TokenRequest request) =>
{
    List<Claim> claims = request.User switch
    {
        "alice" => [new Claim(ClaimTypes.Name, "alice"), new Claim("orders.read", "true")],
        "bob" => [new Claim(ClaimTypes.Name, "bob")],
        _ => [],
    };
    if (claims.Count == 0)
    {
        return Results.BadRequest(new { error = "unknown user (use alice or bob)" });
    }

    var handler = new JsonWebTokenHandler();
    var token = handler.CreateToken(new SecurityTokenDescriptor
    {
        Subject = new ClaimsIdentity(claims),
        Expires = DateTime.UtcNow.AddHours(1),
        SigningCredentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(DemoSigningKey)),
            SecurityAlgorithms.HmacSha256),
    });
    return Results.Ok(new { access_token = token });
});

app.Run();

internal sealed record TokenRequest(string User);
