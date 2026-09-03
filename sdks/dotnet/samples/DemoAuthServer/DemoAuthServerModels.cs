using System.Text.Json.Serialization;

namespace SkMcp.Samples.DemoAuthServer;

internal sealed record RegisteredClient(string ClientId, IReadOnlyList<string> RedirectUris, string? ClientName, DateTimeOffset IssuedAt);

internal sealed record AuthorizationCodeEntry(
    string ClientId, string RedirectUri, string CodeChallenge, Uri? Resource, string User, string? Scope, DateTimeOffset Expires);

internal sealed record RefreshTokenEntry(string ClientId, string User, Uri? Resource, string? Scope, DateTimeOffset Expires);

internal sealed record AuthorizationServerMetadataDocument(
    [property: JsonPropertyName("issuer")] string Issuer,
    [property: JsonPropertyName("authorization_endpoint")] string AuthorizationEndpoint,
    [property: JsonPropertyName("token_endpoint")] string TokenEndpoint,
    [property: JsonPropertyName("registration_endpoint")] string RegistrationEndpoint,
    [property: JsonPropertyName("jwks_uri")] string JwksUri,
    [property: JsonPropertyName("response_types_supported")] string[] ResponseTypesSupported,
    [property: JsonPropertyName("grant_types_supported")] string[] GrantTypesSupported,
    [property: JsonPropertyName("code_challenge_methods_supported")] string[] CodeChallengeMethodsSupported,
    [property: JsonPropertyName("token_endpoint_auth_methods_supported")] string[] TokenEndpointAuthMethodsSupported,
    [property: JsonPropertyName("scopes_supported")] string[] ScopesSupported);

internal sealed record JsonWebKeySetDocument([property: JsonPropertyName("keys")] JsonWebKeyDocument[] Keys);

internal sealed record JsonWebKeyDocument(
    [property: JsonPropertyName("kty")] string Kty,
    [property: JsonPropertyName("use")] string Use,
    [property: JsonPropertyName("kid")] string Kid,
    [property: JsonPropertyName("alg")] string Alg,
    [property: JsonPropertyName("n")] string N,
    [property: JsonPropertyName("e")] string E);

internal sealed record ClientRegistrationRequest(
    [property: JsonPropertyName("redirect_uris")] string[]? RedirectUris,
    [property: JsonPropertyName("client_name")] string? ClientName,
    [property: JsonPropertyName("token_endpoint_auth_method")] string? TokenEndpointAuthMethod,
    [property: JsonPropertyName("grant_types")] string[]? GrantTypes,
    [property: JsonPropertyName("response_types")] string[]? ResponseTypes);

internal sealed record ClientRegistrationResponse(
    [property: JsonPropertyName("client_id")] string ClientId,
    [property: JsonPropertyName("client_id_issued_at")] long ClientIdIssuedAt,
    [property: JsonPropertyName("redirect_uris")] IReadOnlyList<string> RedirectUris,
    [property: JsonPropertyName("client_name")] string? ClientName,
    [property: JsonPropertyName("token_endpoint_auth_method")] string TokenEndpointAuthMethod,
    [property: JsonPropertyName("grant_types")] string[] GrantTypes,
    [property: JsonPropertyName("response_types")] string[] ResponseTypes);

internal sealed record TokenResponse(
    [property: JsonPropertyName("access_token")] string AccessToken,
    [property: JsonPropertyName("token_type")] string TokenType,
    [property: JsonPropertyName("expires_in")] int ExpiresIn,
    [property: JsonPropertyName("refresh_token")] string RefreshToken,
    [property: JsonPropertyName("scope"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Scope);

internal sealed record OAuthErrorResponse(
    [property: JsonPropertyName("error")] string Error,
    [property: JsonPropertyName("error_description")] string ErrorDescription);
