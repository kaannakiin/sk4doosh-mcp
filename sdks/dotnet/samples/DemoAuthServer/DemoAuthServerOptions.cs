using System.Security.Claims;

namespace SkMcp.Samples.DemoAuthServer;

public sealed class DemoAuthServerOptions
{
    public required Uri Issuer { get; init; }

    public required Uri DefaultAudience { get; init; }

    public IReadOnlyDictionary<string, Claim[]> Users { get; init; } = DefaultUsers;

    public string DefaultUser { get; init; } = "alice";

    public static IReadOnlyDictionary<string, Claim[]> DefaultUsers { get; } = new Dictionary<string, Claim[]>
    {
        ["alice"] = [new Claim(ClaimTypes.Name, "alice"), new Claim("orders.read", "true")],
        ["bob"] = [new Claim(ClaimTypes.Name, "bob")],
        ["carol"] = [new Claim(ClaimTypes.Name, "carol"), new Claim(ClaimTypes.Role, "admin")],
    };
}
