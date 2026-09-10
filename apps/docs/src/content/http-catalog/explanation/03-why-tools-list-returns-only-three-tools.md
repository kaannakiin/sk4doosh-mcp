# Why `tools/list` returns only three tools

An MCP server is supposed to list its tools. sk-mcp lists three — `search_tools`, `load_tool`,
`invoke_tool` — and keeps the actual catalog behind them. This is the core of the design, not a
staged rollout.

## The number that decides it

A real backend measured during this project's integration work reported:

```text
sk-mcp catalog: 718 discovered, 718 selected, 698 tools, 11 diagnostic(s)
```

698 tools. Every one with a name, a description, and a full input schema. Handing that to an agent
in one `tools/list` response is not a large payload problem — it is a reasoning problem. The agent
has to hold 698 descriptions in context to pick one, and whatever is left is what it has to
actually do the work with.

The failure is not that it exceeds a limit. It is that an agent asked to choose among 698
similarly-worded options chooses badly, and it does so while spending the context it needed for
the task.

## What search buys

`search_tools` returns compact cards — name, a truncated description, a one-line parameter
summary — and a total. Twenty by default, fifty at most. The agent reads a handful, picks one,
calls `load_tool` for that one's schema, then `invoke_tool`.

The cost of a tool the agent did not choose is one card, not one schema. And because the card is
generated from the same catalog entry as the schema, there is nothing to keep in sync.

## The second-order effects

Two consequences are easy to miss and are most of why the design pays for itself.

**The tool list is nearly static.** Three tools, always the same three. A client can cache
`tools/list` and never think about it again. Compare the alternative: a catalog exposed as tools
changes whenever a deployment adds an endpoint, so every client needs invalidation logic for
something that changes on your release schedule.

What does change is search results, and those are computed per request. Freshness moved from the
tool list, where it is expensive to propagate, into the search, where it is free.

**Per-caller filtering becomes possible at all.** `tools/list` is one response for a session.
Search is a request with a caller attached, so results can be filtered by what that caller may
see. A catalog flattened into `tools/list` would have to be either identical for everyone or
invalidated per identity — and the second one is a cache key on the caller's whole authorization
state.

## What it costs

Three round trips instead of one. An agent that knows exactly which tool it wants still has to
search or already know the name.

That is a real cost and it is paid on every call. The trade is deliberate: three cheap round trips
against a context budget that does not survive 698 schemas, and it only makes sense because the
catalog is large. On a backend with six endpoints, search-first is pure overhead — sk-mcp is not
the right tool for a six-endpoint backend.

## Why not both

The obvious compromise — list the tools when there are few, switch to search when there are many —
was rejected. It makes the protocol a backend's size, so a client cannot be written against one
contract, and a backend that crosses the threshold silently changes shape for every client
connected to it. The exact wire shape is
[the meta-tool contract](/docs/http-catalog/meta-tool-contract), and it is the same at six
endpoints and 698.
