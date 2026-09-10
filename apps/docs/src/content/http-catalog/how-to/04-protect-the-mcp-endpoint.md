# How to protect the MCP endpoint

`/mcp` is an ordinary endpoint in your application. sk-mcp does not authenticate it for you and
never sets up an identity scheme of its own — it uses yours. This page covers the two things you do
have to wire: requiring authorization on the endpoint, and advertising where a client should go to
get a token.

## Require authorization

On ASP.NET Core, `MapSkMcp` returns an `IEndpointConventionBuilder`, so your usual conventions
compose:

```csharp
app.MapSkMcp("/mcp").RequireAuthorization();
```

On NestJS the MCP endpoint is your own controller, so you protect it the way you protect any
controller — a guard on the handler, or the resource-server middleware below.

Without this, anyone who can reach the port can call `invoke_tool`. They still only get through
whatever the _target_ endpoint's own authorization permits, so this is not the last line of
defence, but an unauthenticated caller reaching your pipeline as an anonymous user is rarely what
you want.

## Advertise the authorization server

MCP clients discover where to authenticate through RFC 9728 Protected Resource Metadata. Give
sk-mcp the resource identity and it serves that document.

```csharp
builder.Services.AddSkMcp(options =>
{
    options.ResourceServer.Metadata = new ProtectedResourceMetadata
    {
        Resource = "http://127.0.0.1:5178/mcp",
        AuthorizationServers = { "http://127.0.0.1:5178/oauth" },
        BearerMethodsSupported = ["header"],
        ResourceName = "DemoApi",
    };
});
```

```ts
SkMcpModule.forRoot((options) => {
  options.resourceServer = {
    resource: demoResourceUrl,
    authorizationServers: [demoIssuerUrl],
    resourceName: "demo-api",
    verifier: demoVerifier,
  };
});
```

On NestJS the module installs the middleware itself when `resourceServer` is set, including bearer
verification with an audience check against `resource`. On ASP.NET Core the middleware is part of
`UseSkMcpCapture()`, so it is already in place.

## The metadata path is derived, not fixed

The document is served at `/.well-known/oauth-protected-resource` **concatenated with your MCP
path**. A default `/mcp` therefore means:

```text
/.well-known/oauth-protected-resource/mcp
```

The bare well-known path is not served. Requesting it returns `404` on both SDKs — a working PRM
setup looks broken if you check the wrong URL.

```json
{
  "resource": "http://127.0.0.1:5178/mcp",
  "authorization_servers": ["http://127.0.0.1:5178/oauth"],
  "bearer_methods_supported": ["header"],
  "scopes_supported": [],
  "resource_name": "DemoApi"
}
```

## Let the 401 carry the pointer

sk-mcp does not issue its own challenge. When _your_ authorization returns `401` on the MCP path,
the resource-server middleware decorates that response with a `WWW-Authenticate` header naming the
metadata document:

```text
WWW-Authenticate: Bearer resource_metadata="http://127.0.0.1:5178/.well-known/oauth-protected-resource/mcp"
```

That is how a client that arrives with no token discovers the authorization server: it gets a
`401`, reads the header, fetches the metadata, and starts the OAuth flow. The example client in
this repository does exactly that under `SKMCP_AUTH=oauth`.

## Verify the result

With the backend running, both halves are one request each:

```bash
curl -s http://127.0.0.1:5178/.well-known/oauth-protected-resource/mcp
curl -s -i -X POST http://127.0.0.1:5178/mcp -H 'content-type: application/json' -d '{}'
```

The first returns the JSON above. The second returns `401` carrying the `WWW-Authenticate` header.
If the header is missing, `ResourceServer.Metadata` is unset. If the metadata returns `404`, check
that the path includes your MCP route.

## Scopes stay with your authorization server

sk-mcp models no scopes and grants nothing. `scopes_supported` is passed through from your options
for clients to read; what a token is allowed to do is decided by your authorization server and your
endpoints. The normative transport rules are in
[`packages/spec/transport.md`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/spec/transport.md).

## One transport detail that looks like a bug

The default NestJS session mode is `stateless`, which serves `POST` only and answers `GET` and
`DELETE` with `405`. Behind bearer verification you see `401` before that ever applies, which is
why a `GET /mcp` probe tells you less than you might expect about whether the endpoint works.
