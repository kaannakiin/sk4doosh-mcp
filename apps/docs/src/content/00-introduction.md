# Introduction

sk-mcp is an MCP (Model Context Protocol) layer that embeds into an existing backend. The goal is
to make the surface your backend exposes to agents describable without writing a separate service
for it.

Making a REST API usable by an agent usually takes two steps today: you stand up a separate MCP
server, and you re-describe every endpoint inside it. That copy drifts. The backend changes, the
MCP layer falls behind, and nobody notices until an agent calls something that no longer exists.

sk-mcp keeps the description inside the backend instead. The endpoint is already there; sk-mcp
turns it into a tool the agent understands.

## Search-first discovery

An sk-mcp backend exposes exactly three tools, no matter how many endpoints it has:

| Tool           | Purpose                                                            |
| -------------- | ------------------------------------------------------------------ |
| `search_tools` | Find endpoints. An empty query lists everything the caller can see |
| `load_tool`    | Fetch one tool's input schema                                      |
| `invoke_tool`  | Call it                                                            |

Hundreds of endpoints never enter an agent's context at once. The agent searches, loads the schema
of what it found, then calls. The tool list almost never changes, so clients have no cache problem;
what changes is the search results, and those are fresh every time.

## How these docs are organized

Four sections, each answering a different kind of question:

- **Tutorial** — you are learning. Follow the steps, end up with something working.
- **How-to** — you are working. A task, solved.
- **Reference** — you need a fact. Dry, complete, no narrative.
- **Explanation** — you want to understand why a design is the way it is.

The same topic appears in more than one section. That is deliberate, not duplication: visibility
has a tutorial, a how-to, a reference page, and an explanation, because those four answer four
different questions.

For the normative rules, read the spec in `packages/spec`. These pages describe; the spec binds.
