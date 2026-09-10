# Introduction

The HTTP catalog is the sk-mcp product line that exposes an existing HTTP backend to agents. Two
SDKs implement it — one for ASP.NET Core, one for NestJS — against a single normative spec and a
shared conformance fixture corpus. The goal is to make the surface your backend exposes to agents
describable without writing a separate service for it.

Making a REST API usable by an agent usually takes two steps today: you stand up a separate MCP
server, and you re-describe every endpoint inside it. That copy drifts. The backend changes, the
MCP layer falls behind, and nobody notices until an agent calls something that no longer exists.

sk-mcp keeps the description inside the backend instead. The endpoint is already there; sk-mcp
turns it into a tool the agent understands, and dispatches the agent's call back through your own
middleware pipeline, so authorization runs where it already lives.

## Start here

- [Exposing your first ASP.NET Core endpoint to an agent](/docs/http-catalog/exposing-your-first-aspnet-core-endpoint) — if your backend is ASP.NET Core.
- [Mounting your first NestJS MCP endpoint](/docs/http-catalog/mounting-your-first-nestjs-mcp-endpoint) — if your backend is NestJS.

The two paths are genuinely different: the .NET SDK maps the MCP endpoint for you, the NestJS SDK
does not. [Why the two SDKs do not feel the same](/docs/http-catalog/why-the-two-sdks-do-not-feel-the-same)
explains what drives that.

## Search-first discovery

An sk-mcp backend exposes exactly three tools, no matter how many endpoints it has:

- `search_tools` finds endpoints. An empty query lists everything the caller can see.
- `load_tool` fetches one tool's input schema.
- `invoke_tool` calls it.

Hundreds of endpoints never enter an agent's context at once. The agent searches, loads the schema
of what it found, then calls.
[Why `tools/list` returns only three tools](/docs/http-catalog/why-tools-list-returns-only-three-tools)
argues the case; the [meta-tool contract](/docs/http-catalog/meta-tool-contract) is the exact wire
shape.

## How these docs are organized

Four sections, each answering a different kind of question about this product line:

- **Tutorial** — you are learning. Follow the steps, end up with something working.
- **How-to** — you are working. A task, solved.
- **Reference** — you need a fact. Dry, complete, no narrative.
- **Explanation** — you want to understand why a design is the way it is.

The same topic appears in more than one section. That is deliberate, not duplication: visibility
has a tutorial, a how-to, a reference page, and an explanation, because those four answer four
different questions.

For the normative rules, read the spec in
[`packages/spec`](https://github.com/kaannakiin/sk4doosh-mcp/tree/main/packages/spec). These pages
describe; the spec binds.
