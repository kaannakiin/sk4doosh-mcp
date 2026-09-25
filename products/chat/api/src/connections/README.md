# Connections

This module answers a question the platform login never has to: _given a
signed-in user, which external MCP server may they act through, and with what
access?_

## Connection vs. login

Login (`products/chat/api/src/auth/*`) answers "who is this person in this
product?". A **connection** answers a separate question: "which external
system may this signed-in user reach, and with what access?".

- **Integration** — the platform's record of one remote MCP server
  (`Integration` in `products/chat/db/prisma/models/integration/integration.prisma`).
  An integration has an `origin`: `partner` (onboarded once, offered to every
  user) or `user` (a server one person pointed the product at, visible only to
  them).
- **Connection** — one user's authorized link to one integration
  (`Connection` in `connection.prisma`). `@@unique([userId, integrationId])`
  means a user holds at most one connection per integration; a fresh
  authorization updates that row rather than inserting beside it.
- **ConnectionScope** — what the user actually consented to hand over,
  distinct from what the provider's token could technically do.

A connection is not owned by a chat session — it is looked up by
`(sessionUserId, integrationId)` on every tool call, never by a client-supplied
identifier.

## Connection levels

Only OAuth and open (unauthenticated) connections are built:

- **OAuth** (`Integration.authMode = "oauth"`) — the RFC 8414/9728/7591
  discovery, dynamic client registration and authorization-code flow, built
  across `authorization-discovery.service.ts`, `client-registration.service.ts`,
  `oauth-client.ts`, `connection-authorization.service.ts` and
  `connection-token.service.ts`.
- **Open** (`Integration.authMode = "none"`) — a server that answers
  `tools/list` without a token. `registerOpen` (in
  `integration-registration.service.ts`) proves openness by calling
  `tools/list` unauthenticated rather than trusting a claim; if the server
  turns out to require a token, the row is upgraded to `oauth` in place.

Not built: SDK-assisted delegated auth (an adapter over a partner's own
session/JWT system), and PAT/API-key connections. `IntegrationAuthMode` only
has `oauth` and `none` — there is no schema support for a third mode yet.

## Effective permission

Authorization is decided once, at invoke time, in
`@chat/contracts/integration/authorize-invocation.ts`
(`authorizeInvocation`), never from tool visibility. The strategy is chosen by
the integration's `origin` (`STRATEGY_BY_ORIGIN`), not by whether a scope map
happens to be empty — an integration whose manifest failed to load also has no
scope rows, and treating that as "no scopes declared, therefore unrestricted"
would authorize every tool on a real partner backend:

- **`partner`** — `granted_scope`. The tool must resolve to exactly one scope
  in `IntegrationToolScope` (the partner's published manifest), and that scope
  must be in the connection's `ConnectionScope` rows (what the user consented
  to). `IntegrationToolScope` is populated by hand today — nothing in this
  module writes it — so effective permission for a partner tool is presently
  `manifest membership ∩ user consent`, not `provider grant ∩ user consent ∩
platform policy`: partner integration registration and scope publishing are
  not built (see the repository's `ROADMAP.md`).
- **`user`** — `connection_only`. There is no scope map for a server the user
  pointed the product at themselves, so the connection itself is the grant.
  The user-facing backstop for this case is tool approval: a server a user
  adds starts at `always_ask`, and trusting it more is the user's choice (see
  "Tool approval" below).

Before any of this runs, `authorizeInvocation` also checks connection
ownership (`connection.ownerId !== sessionUserId`), integration match
(`connection.integrationId !== integration.id`) and connection status
(`active` only) — each with its own denial reason, and a missing connection
denies with the same reason as one owned by someone else, so a caller cannot
use the response to enumerate other users' connections.

## Tool approval

Whether a tool call needs the user's consent is decided per call by
`decideToolApproval` (`@chat/contracts/tools/approval-decision.ts`), in this
order:

1. The product's own posture for the tool (`CHAT_TOOL_POLICY`): `auto` never
   asks, `always` (`codex_task`) always asks, and nothing below can change
   either.
2. The user's per-tool override (`tool_approval_override`): `always_ask`, or
   `auto`. An `auto` override is bound to the tool definition it was given
   for and asks again once the server rewrites the tool. This is the only
   setting that can let a tool the server calls destructive run unasked.
3. The server's destructive hint: asks.
4. The integration's mode (`integration_approval_setting`), else the user's
   own mode: `always_ask`, `remember` (a remembered grant decides) or `auto`.
   A server the user adds starts at `always_ask`; an integration with no row
   follows the user's own mode.

`grantCanApply` answers, from the same inputs, whether "don't ask again" is
worth offering, and the gate copies that onto each tool's metadata so the
prompt never offers a grant the gate would ignore.

## Security invariants the code enforces

- **Tool visibility is not a security boundary.** `IntegrationCatalogService`
  and `find_tools` decide what a model is _shown_; `authorizeInvocation` is
  the only gate that decides what a model may _run_, and it runs regardless of
  how the tool call was discovered.
- **The coding agent reaches no tool except through this process.** Its
  threads are given one MCP server, the agent gateway
  (`products/chat/api/src/gateway/`), on a loopback port with a bearer grant
  that lives for one turn. Every reader, the local worker and every connected
  server sit behind it, so a call from the agent — or from a sub-agent it
  spawned — passes the turn's approval gate and, for a connected server,
  `authorizeInvocation` and the token service, exactly as a call from the chat
  model does. Codex never holds a connection's token.
- **Ownership is re-checked on every invoke from the trusted session**, never
  from a client-supplied connection id — `authorize-invocation.ts`.
- **Only an `active` connection may be used.** `revoked` and `reauth_required`
  both deny before any credential is touched — `authorize-invocation.ts`,
  backed by the `connection_token_state_check` constraint in
  `connection.prisma`, which refuses to let a non-`active` row hold a token.
- **Redirects are never followed for a request that carries a credential.**
  `guardedFollow` (`guarded-http.ts`) takes the hop budget from the caller:
  token, registration and MCP requests pass `0`; only metadata reads, which
  carry nothing to leak, follow up to three hops (`oauth-client.ts`,
  `remote-mcp.client.ts`).
- **Every outbound socket is re-validated at connect time, not before it.**
  `publicOnlyLookup` in `guarded-http.ts` inspects every DNS answer and rejects
  a private/loopback address inside the `lookup` callback itself, closing the
  DNS-rebinding window between "checked" and "connected".
- **A user cannot register the same server url twice.** The partial unique
  index `integration_owner_url_key` on `(owner_id, mcp_url)` for
  `origin = 'user'` (the `20260915223000_integration_registry` migration)
  enforces it.
- **The OAuth callback never trusts a free-floating identity.** A callback
  is matched to an open attempt by its `state` and refused when that attempt
  belongs to another session (`connection-authorization.service.ts`); the
  connection's owner comes from the session, never from the callback URL.

## Known limits

- **The tool-refresh lease is shared per integration.** Refreshing a
  stale tool list is claimed with a lease (`IntegrationToolRepository.claimRefresh`
  in `integration-tool.repository.ts`), and the lease is keyed by
  `integrationId` alone. Two users connected to the _same_ partner integration
  share one refresh window, so one user's refresh suppresses the other's for
  the lease duration. Not a correctness bug — a stale list is still usable —
  but worth knowing before a first partner integration ships with shared
  connections.
- **Scope map has no consent versioning.** If a partner narrows or widens
  which scope a tool requires, a user who consented under the old mapping is
  not re-prompted — see `ROADMAP.md` for the two ways to close this before
  partner scope publishing ships.
- **Argument blindness.** A remembered tool approval covers the tool
  definition, not the arguments it was called with — see the guard on
  `ToolApprovalGate` in `tool-approval-gate.service.ts`.
