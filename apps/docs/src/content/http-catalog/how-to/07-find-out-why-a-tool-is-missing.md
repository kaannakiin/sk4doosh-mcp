# How to find out why a tool is missing

An endpoint exists, `search_tools` does not return it. This page is the order to check things in.
Work top to bottom; each step rules out one cause.

## 1. Read the catalog line

The catalog is built at startup and reports itself. Find this line in your host's log before doing
anything else:

```text
info: SkMcp.AspNetCore.SkMcpCatalogProvider[0]
      sk-mcp catalog: 16 discovered, 9 selected, 9 tools, 0 diagnostic(s)
```

Four numbers, and the gap between them names the layer that lost your endpoint.

- `discovered` is what the framework knows about. If it is `0`, discovery found nothing — on
  ASP.NET Core that usually means `AddEndpointsApiExplorer()` is missing from a host that does not
  get it implicitly.
- `discovered` → `selected` is **selection**. This is the most common gap by a wide margin.
- `selected` → `tools` is **catalog construction**: endpoints that were selected but could not be
  turned into a callable tool. The diagnostics say which.
- `diagnostic(s)` is the count to read next when the gap is there.

If `tools` includes your endpoint, the catalog is fine and the problem is per-caller — skip to
step 4.

## 2. Rule out selection

Selection defaults to opt-in. With no `[McpTool]` / `@McpTool()` anywhere, `selected` is `0` and
`search_tools` is empty for everyone, always.

A partially decorated backend is the subtler version: the controller is marked but the method is
not on the route you expected, or an `[McpIgnore]` on the class is silently winning over nothing on
the method. Selection precedence and the two modes are in
[how to choose which endpoints become tools](/docs/http-catalog/choose-which-endpoints-become-tools).

## 3. Read the diagnostics

When `selected` is higher than `tools`, one or more endpoints were dropped and a diagnostic names
each one. Diagnostics have three severities:

- **warning** — recorded, nothing dropped. The default for any code without an explicit severity.
- **endpointDropped** — that endpoint is not a tool; the rest of the catalog is fine.
- **fatal** — the catalog itself is not trustworthy, and the host refuses to start.

Three codes are fatal by default: `name_collision`, `ambiguous_selection` and `invalid_name`. All
three mean two declarations disagree in a way sk-mcp will not silently resolve — a conflict is an
error here, never a coin flip.

Seven are `endpointDropped` by default and are the ones to expect when a single endpoint vanishes:
`argument_collision`, `schema_def_conflict`, `unsupported_method`, `unsupported_binding`,
`multiple_body_bindings`, `template_rejected` and — on ASP.NET Core — `missing_http_method`.

In practice the two you will actually hit are `argument_collision` (a path or query parameter and a
body property share a name, so the flat argument object cannot represent both) and
`unsupported_binding` (a form-encoded body, an `IFormFile`, a wildcard route — bindings with no
JSON-argument equivalent).

The complete lists live in the source, one per SDK:
[`DiagnosticCodes.cs`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/sdks/dotnet/src/SkMcp.AspNetCore/Discovery/DiagnosticCodes.cs)
and
[`diagnostics.ts`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/sdks/nestjs/src/discovery/diagnostics.ts).
There is no single cross-SDK table, because the two sets are not identical.

## 4. Rule out visibility

If the tool is in the catalog but a given caller cannot see it, that is the visibility filter
working. Search as a caller you know is allowed and compare the result counts. The rules are on
[visibility decision](/docs/http-catalog/visibility-decision); changing the outcome is
[how to control what a caller can see](/docs/http-catalog/control-what-a-caller-can-see).

On NestJS there is one extra cause worth checking early: a guard without `describeVisibility()`
pins the endpoint to `unknown`, and if you set `visibility.onUnknown: "hide"`, every such endpoint
disappears from search for everyone. See
[how to declare visibility for a NestJS guard](/docs/http-catalog/declare-visibility-for-a-nestjs-guard).

## 5. Change a severity, once you know which

Having identified the code, you can move it. Downgrade to keep an endpoint you decided you can live
without, or escalate to make a warning stop the build:

```csharp
builder.Services.AddSkMcp(options =>
{
    options.Diagnostics.Downgrade.Add(DiagnosticCodes.NameCollision);
    options.Diagnostics.Escalate.Add(DiagnosticCodes.UnreadableShape);
});
```

```ts
SkMcpModule.forRoot((options) => {
  options.diagnostics.downgrade.add("name_collision");
  options.diagnostics.escalate.add("unreadable_shape");
});
```

`diagnostics.failOn` sets the threshold that stops startup, `fatal` by default.

Downgrading a fatal code is a deliberate decision to ship a catalog with a known conflict in it —
`name_collision` downgraded means two endpoints compete for one tool name and which one an agent
reaches is not something the catalog promises. Fix the names instead where you can.

## What the numbers cannot tell you

The catalog line counts endpoints, not correctness. A tool that exists with a weaker contract than
you intended — an opaque body from `unreadable_shape`, a truncated schema from
`schema_depth_truncated` — is a `warning` and shows up in `tools` like any other. If an agent can
find your tool but cannot call it correctly, read the warnings you skipped.
