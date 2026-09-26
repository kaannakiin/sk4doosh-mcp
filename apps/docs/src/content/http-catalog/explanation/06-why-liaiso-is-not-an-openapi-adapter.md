# Why liaiso is not an OpenAPI adapter

The usual way to put an HTTP API in front of an agent is an adapter: read the OpenAPI document,
turn each operation into a tool, and call the backend over the network. FastMCP's OpenAPI
integration is the best-known example. liaiso starts from a different place, and the difference is
worth stating plainly because it decides what each approach can promise.

## Outside the backend or inside it

An adapter sits **outside** the backend. It knows what the document says and nothing else: not who
the caller is to the backend, not which endpoints that caller may use, not what the backend will do
with a request the document describes loosely.

liaiso sits **inside** it. An SDK reads the framework's own route and authorization metadata,
replays each tool call as a synthetic request through the backend's own pipeline, carries the
caller's identity with it, and turns the backend's own authorization decision into what the caller
can see. A tool call cannot do more than an HTTP call by the same caller, because it _is_ one.

FastMCP's author positions the adapter as a prototyping tool — "bootstrap, don't deploy" — and the
critique behind that advice applies to any catalog of generated tools: the context fills up, agents
chain atomic calls badly, and near-duplicate tools make them hesitate. liaiso's answer is structural
rather than advisory:

- **Search first.** `tools/list` returns three meta-tools, not the catalog; the agent searches,
  loads the one tool it needs, and invokes it
  ([why tools/list returns only three tools](/docs/http-catalog/why-tools-list-returns-only-three-tools)).
- **Three-valued visibility.** A tool the caller cannot use is not shown; a tool whose rule cannot
  be read ahead of time is shown with `authUncertain` instead of guessed.
- **Naming discipline.** A name is stable and a collision is an error, so a name an agent learned
  does not move when a neighbouring endpoint is added.
- **Curation.** A host renames, re-describes, hides or fills arguments without touching the
  backend's contract ([curate the arguments an agent sees](/docs/http-catalog/curate-the-arguments-an-agent-sees)).

## What liaiso refuses to do silently

Every adapter we reviewed resolves something quietly. These are the resolutions liaiso turns into
errors or declines outright:

| An adapter may…                                          | liaiso instead…                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| append `_2` to a colliding name, or cut a long one       | fails the catalog with `name_collision`; the host resolves it by name        |
| drop an argument it does not recognise, with a log line  | answers `unknown_argument` and lists the names it accepts                    |
| pick the first media type an operation lists             | applies one ordered selection rule, so the list's order does not matter      |
| pass the backend's error body to the agent, 401 included | maps errors to a fixed dictionary and never forwards a 401, 5xx or HTML body |
| forward every header of the MCP request to the backend   | forwards only declared identity carriers                                     |
| route by an ordered map where the first match wins       | resolves selection by specificity, and a tie is `ambiguous_selection`        |
| let catalog visibility decide whether a call is allowed  | enforces in the backend at invoke time, whatever search showed               |
| truncate an oversized response                           | refuses it with the size, the limit and the arguments that would narrow it   |

A silent resolution is cheap on the day it is written and expensive on the day an agent acts on it:
a truncated body looks complete, a dropped filter returns more rows than asked for, and a shifted
name calls a different endpoint.

## When there is only a document

Embedding needs an SDK, and liaiso has two: ASP.NET Core and NestJS. A backend on any other stack
can still be reached through its OpenAPI document, and liaiso reads Swagger 2.0 and OpenAPI 3.0–3.2
for that case. The document becomes the same `EndpointDescriptor`s an SDK would produce, and from
there naming, selection, curation, schema rules, request composition, error mapping, search and the
response budget are the same code path.

What is lost is exactly what only the inside can know. A document says which credential an
operation needs, not who may use it, so every tool is shown with `authUncertain` unless the
operation is explicitly anonymous. There is no probe either: an embedded probe stops a synthetic
request before the handler runs, but a remote request would run it for real.

What is gained over a typical adapter is the refusal table above, plus one more: every construct
the reader cannot carry is a diagnostic with a JSON pointer into the document, never a quiet
fallback. The rules are in the
[OpenAPI ingestion spec](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/http/spec/openapi-ingestion.md).

## How the promises are kept

Each rule above is written down before it is implemented, in the
[normative spec](https://github.com/kaannakiin/sk4doosh-mcp/tree/main/packages/http/spec), and
pinned by a fixture corpus that two independent implementations — TypeScript and C# — must both
pass. A behaviour that only one implementation has is not a behaviour liaiso promises.
