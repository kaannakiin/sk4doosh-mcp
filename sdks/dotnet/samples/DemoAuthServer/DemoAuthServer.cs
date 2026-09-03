using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace SkMcp.Samples.DemoAuthServer;

public sealed class DemoAuthServer
{
    private readonly DemoAuthServerOptions _options;
    private readonly RSA _signingKey;
    private readonly string _keyId;
    private readonly SigningCredentials _signingCredentials;
    private readonly ConcurrentDictionary<string, RegisteredClient> _clients = new();
    private readonly ConcurrentDictionary<string, AuthorizationCodeEntry> _authorizationCodes = new();
    private readonly ConcurrentDictionary<string, RefreshTokenEntry> _refreshTokens = new();

    public DemoAuthServer(DemoAuthServerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options;
        _signingKey = RSA.Create(2048);
        _keyId = Guid.NewGuid().ToString("N");
        _signingCredentials = new SigningCredentials(new RsaSecurityKey(_signingKey) { KeyId = _keyId }, SecurityAlgorithms.RsaSha256);
        PublicKey = new RsaSecurityKey(_signingKey.ExportParameters(includePrivateParameters: false)) { KeyId = _keyId };
    }

    public RsaSecurityKey PublicKey { get; }

    public Uri Issuer => _options.Issuer;

    internal Uri DefaultAudience => _options.DefaultAudience;

    public string IssueAccessToken(string user, Uri audience, string? scope)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(user);
        ArgumentNullException.ThrowIfNull(audience);

        List<Claim> claims = [new("sub", user), new("jti", Guid.NewGuid().ToString("N"))];
        if (!string.IsNullOrEmpty(scope))
        {
            claims.Add(new Claim("scope", scope));
        }
        if (_options.Users.TryGetValue(user, out Claim[]? userClaims))
        {
            claims.AddRange(userClaims);
        }

        JsonWebTokenHandler handler = new();
        return handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = _options.Issuer.ToString(),
            Audience = audience.ToString(),
            IssuedAt = DateTime.UtcNow,
            Expires = DateTime.UtcNow.AddHours(1),
            Subject = new ClaimsIdentity(claims),
            SigningCredentials = _signingCredentials,
        });
    }

    internal string ResolveUser(string? loginHint) =>
        loginHint is not null && _options.Users.ContainsKey(loginHint) ? loginHint : _options.DefaultUser;

    internal string RegisterClient(IReadOnlyList<string> redirectUris, string? clientName)
    {
        string clientId = Guid.NewGuid().ToString("N");
        _clients[clientId] = new RegisteredClient(clientId, redirectUris, clientName, DateTimeOffset.UtcNow);
        return clientId;
    }

    internal bool TryGetClient(string clientId, [NotNullWhen(true)] out RegisteredClient? client) =>
        _clients.TryGetValue(clientId, out client);

    internal string StoreAuthorizationCode(AuthorizationCodeEntry entry)
    {
        string code = GenerateOpaqueToken();
        _authorizationCodes[code] = entry;
        return code;
    }

    internal bool TryConsumeAuthorizationCode(string code, [NotNullWhen(true)] out AuthorizationCodeEntry? entry)
    {
        if (_authorizationCodes.TryRemove(code, out AuthorizationCodeEntry? removed) && removed.Expires > DateTimeOffset.UtcNow)
        {
            entry = removed;
            return true;
        }
        entry = null;
        return false;
    }

    internal string StoreRefreshToken(RefreshTokenEntry entry)
    {
        string token = GenerateOpaqueToken();
        _refreshTokens[token] = entry;
        return token;
    }

    internal bool TryConsumeRefreshToken(string token, [NotNullWhen(true)] out RefreshTokenEntry? entry)
    {
        if (_refreshTokens.TryRemove(token, out RefreshTokenEntry? removed) && removed.Expires > DateTimeOffset.UtcNow)
        {
            entry = removed;
            return true;
        }
        entry = null;
        return false;
    }

    private static string GenerateOpaqueToken() => Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(32));
}
