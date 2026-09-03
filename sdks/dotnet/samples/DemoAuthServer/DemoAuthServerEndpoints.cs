using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.IdentityModel.Tokens;

namespace SkMcp.Samples.DemoAuthServer;

public static class DemoAuthServerEndpoints
{
    private const string AuthorizationCodeGrant = "authorization_code";
    private const string RefreshTokenGrant = "refresh_token";

    public static IEndpointRouteBuilder MapDemoAuthorizationServer(this IEndpointRouteBuilder endpoints, DemoAuthServer server)
    {
        ArgumentNullException.ThrowIfNull(endpoints);
        ArgumentNullException.ThrowIfNull(server);

        string issuerPath = server.Issuer.AbsolutePath.TrimEnd('/');

        endpoints.MapGet($"/.well-known/oauth-authorization-server{issuerPath}", (HttpContext context) =>
        {
            AllowAnyOrigin(context);
            return Results.Json(BuildMetadata(server));
        }).AllowAnonymous();

        endpoints.MapGet($"{issuerPath}/.well-known/openid-configuration", (HttpContext context) =>
        {
            AllowAnyOrigin(context);
            return Results.Json(BuildMetadata(server));
        }).AllowAnonymous();

        endpoints.MapGet($"{issuerPath}/jwks", (HttpContext context) =>
        {
            AllowAnyOrigin(context);
            return Results.Json(BuildJwks(server));
        }).AllowAnonymous();

        endpoints.MapGet($"{issuerPath}/authorize", (HttpRequest request) => HandleAuthorize(server, request))
            .AllowAnonymous();

        endpoints.MapPost($"{issuerPath}/token", (HttpRequest request) => HandleTokenAsync(server, request))
            .AllowAnonymous();

        endpoints.MapPost($"{issuerPath}/register", (HttpRequest request) => HandleRegisterAsync(server, request))
            .AllowAnonymous();

        return endpoints;
    }

    private static void AllowAnyOrigin(HttpContext context) =>
        context.Response.Headers["Access-Control-Allow-Origin"] = "*";

    private static AuthorizationServerMetadataDocument BuildMetadata(DemoAuthServer server)
    {
        string issuer = server.Issuer.ToString().TrimEnd('/');
        return new AuthorizationServerMetadataDocument(
            Issuer: issuer,
            AuthorizationEndpoint: $"{issuer}/authorize",
            TokenEndpoint: $"{issuer}/token",
            RegistrationEndpoint: $"{issuer}/register",
            JwksUri: $"{issuer}/jwks",
            ResponseTypesSupported: ["code"],
            GrantTypesSupported: [AuthorizationCodeGrant, RefreshTokenGrant],
            CodeChallengeMethodsSupported: ["S256"],
            TokenEndpointAuthMethodsSupported: ["none"],
            ScopesSupported: []);
    }

    private static JsonWebKeySetDocument BuildJwks(DemoAuthServer server)
    {
        RSAParameters parameters = server.PublicKey.Parameters;
        JsonWebKeyDocument key = new(
            Kty: "RSA",
            Use: "sig",
            Kid: server.PublicKey.KeyId,
            Alg: "RS256",
            N: Base64UrlEncoder.Encode(parameters.Modulus),
            E: Base64UrlEncoder.Encode(parameters.Exponent));
        return new JsonWebKeySetDocument([key]);
    }

    private static IResult HandleAuthorize(DemoAuthServer server, HttpRequest request)
    {
        string? clientId = request.Query["client_id"];
        string? redirectUri = request.Query["redirect_uri"];
        string? responseType = request.Query["response_type"];
        string? codeChallenge = request.Query["code_challenge"];
        string? codeChallengeMethod = request.Query["code_challenge_method"];
        string? scope = request.Query["scope"];
        string? state = request.Query["state"];
        string? resource = request.Query["resource"];
        string? loginHint = request.Query["login_hint"];

        if (string.IsNullOrEmpty(clientId) || !server.TryGetClient(clientId, out RegisteredClient? client))
        {
            return Error("invalid_client", "Unknown client_id.");
        }
        if (string.IsNullOrEmpty(redirectUri) || !client.RedirectUris.Contains(redirectUri, StringComparer.Ordinal))
        {
            return Error("invalid_request", "redirect_uri does not match a registered value.");
        }
        if (responseType != "code")
        {
            return Error("unsupported_response_type", "Only 'code' is supported.");
        }
        if (string.IsNullOrEmpty(codeChallenge) || codeChallengeMethod != "S256")
        {
            return Error("invalid_request", "PKCE with S256 is required.");
        }

        Uri? resourceUri = null;
        if (!string.IsNullOrEmpty(resource) && !Uri.TryCreate(resource, UriKind.Absolute, out resourceUri))
        {
            return Error("invalid_target", "resource must be an absolute URI.");
        }

        string user = server.ResolveUser(loginHint);
        string code = server.StoreAuthorizationCode(new AuthorizationCodeEntry(
            clientId, redirectUri, codeChallenge, resourceUri, user, scope, DateTimeOffset.UtcNow.AddMinutes(5)));

        StringBuilder location = new StringBuilder(redirectUri)
            .Append(redirectUri.Contains('?') ? '&' : '?')
            .Append("code=").Append(Uri.EscapeDataString(code));
        if (!string.IsNullOrEmpty(state))
        {
            location.Append("&state=").Append(Uri.EscapeDataString(state));
        }
        return Results.Redirect(location.ToString());
    }

    private static async Task<IResult> HandleTokenAsync(DemoAuthServer server, HttpRequest request)
    {
        if (!request.HasFormContentType)
        {
            return Error("invalid_request", "Expected an application/x-www-form-urlencoded body.");
        }

        IFormCollection form = await request.ReadFormAsync();
        string? grantType = form["grant_type"];
        return grantType switch
        {
            AuthorizationCodeGrant => HandleAuthorizationCodeGrant(server, form),
            RefreshTokenGrant => HandleRefreshTokenGrant(server, form),
            _ => Error("unsupported_grant_type", "grant_type must be authorization_code or refresh_token."),
        };
    }

    private static IResult HandleAuthorizationCodeGrant(DemoAuthServer server, IFormCollection form)
    {
        string? code = form["code"];
        string? redirectUri = form["redirect_uri"];
        string? clientId = form["client_id"];
        string? codeVerifier = form["code_verifier"];
        string? resource = form["resource"];

        if (string.IsNullOrEmpty(code) || !server.TryConsumeAuthorizationCode(code, out AuthorizationCodeEntry? entry))
        {
            return Error("invalid_grant", "Unknown, expired or already-used code.");
        }
        if (entry.ClientId != clientId || entry.RedirectUri != redirectUri)
        {
            return Error("invalid_grant", "client_id or redirect_uri does not match the authorization request.");
        }
        if (string.IsNullOrEmpty(codeVerifier) || !VerifyCodeChallenge(codeVerifier, entry.CodeChallenge))
        {
            return Error("invalid_grant", "code_verifier does not match code_challenge.");
        }

        if (!TryResolveAudience(resource, entry.Resource, server, out Uri? audience))
        {
            return Error("invalid_target", "resource must be an absolute URI.");
        }
        return IssueTokenResponse(server, entry.ClientId, entry.User, audience, entry.Scope);
    }

    private static IResult HandleRefreshTokenGrant(DemoAuthServer server, IFormCollection form)
    {
        string? refreshToken = form["refresh_token"];
        string? clientId = form["client_id"];
        string? resource = form["resource"];

        if (string.IsNullOrEmpty(refreshToken) || !server.TryConsumeRefreshToken(refreshToken, out RefreshTokenEntry? entry))
        {
            return Error("invalid_grant", "Unknown or already-used refresh_token.");
        }
        if (entry.ClientId != clientId)
        {
            return Error("invalid_grant", "client_id does not match the refresh_token.");
        }

        if (!TryResolveAudience(resource, entry.Resource, server, out Uri? audience))
        {
            return Error("invalid_target", "resource must be an absolute URI.");
        }
        return IssueTokenResponse(server, entry.ClientId, entry.User, audience, entry.Scope);
    }

    private static bool TryResolveAudience(string? requestedResource, Uri? storedResource, DemoAuthServer server, out Uri audience)
    {
        if (string.IsNullOrEmpty(requestedResource))
        {
            audience = storedResource ?? server.DefaultAudience;
            return true;
        }
        if (Uri.TryCreate(requestedResource, UriKind.Absolute, out Uri? parsed))
        {
            audience = parsed;
            return true;
        }
        audience = server.DefaultAudience;
        return false;
    }

    private static IResult IssueTokenResponse(DemoAuthServer server, string clientId, string user, Uri audience, string? scope)
    {
        string accessToken = server.IssueAccessToken(user, audience, scope);
        string refreshToken = server.StoreRefreshToken(
            new RefreshTokenEntry(clientId, user, audience, scope, DateTimeOffset.UtcNow.AddDays(30)));
        return Results.Json(new TokenResponse(accessToken, "Bearer", 3600, refreshToken, scope));
    }

    private static bool VerifyCodeChallenge(string codeVerifier, string codeChallenge)
    {
        byte[] hash = SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier));
        byte[] computed = Encoding.ASCII.GetBytes(Base64UrlEncoder.Encode(hash));
        byte[] expected = Encoding.ASCII.GetBytes(codeChallenge);
        return computed.Length == expected.Length && CryptographicOperations.FixedTimeEquals(computed, expected);
    }

    private static async Task<IResult> HandleRegisterAsync(DemoAuthServer server, HttpRequest request)
    {
        ClientRegistrationRequest? body;
        try
        {
            body = await JsonSerializer.DeserializeAsync<ClientRegistrationRequest>(request.Body);
        }
        catch (JsonException)
        {
            return Error("invalid_client_metadata", "Request body is not valid JSON.");
        }

        if (body?.RedirectUris is not { Length: > 0 } redirectUris ||
            redirectUris.Any(uri => !Uri.TryCreate(uri, UriKind.Absolute, out _)))
        {
            return Error("invalid_client_metadata", "redirect_uris must be a non-empty array of absolute URIs.");
        }
        if (body.TokenEndpointAuthMethod is not (null or "none" or "client_secret_post" or "client_secret_basic"))
        {
            return Error("invalid_client_metadata", "token_endpoint_auth_method is not supported.");
        }

        string[] grantTypes = body.GrantTypes is { Length: > 0 } ? body.GrantTypes : [AuthorizationCodeGrant, RefreshTokenGrant];
        string[] responseTypes = body.ResponseTypes is { Length: > 0 } ? body.ResponseTypes : ["code"];
        string clientId = server.RegisterClient(redirectUris, body.ClientName);

        return Results.Json(
            new ClientRegistrationResponse(
                clientId, DateTimeOffset.UtcNow.ToUnixTimeSeconds(), redirectUris, body.ClientName, "none", grantTypes, responseTypes),
            statusCode: StatusCodes.Status201Created);
    }

    private static IResult Error(string error, string description) =>
        Results.Json(new OAuthErrorResponse(error, description), statusCode: StatusCodes.Status400BadRequest);
}
