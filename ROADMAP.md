# Roadmap

Work that is designed or wanted but not built. Each item says what is missing today, so it can be
checked against the code. When an item ships, delete it here and put its rules where they bind — the
spec, a guard comment or the package README.

## HTTP catalog and the OpenAPI gateway

- **Whole-document validation.** Ingestion validates by point checks on the constructs it lowers
  ([openapi-ingestion.md](packages/http/spec/openapi-ingestion.md), pipeline step 3). A defect in a
  part nothing reads produces no diagnostic. Validate against the version's own meta-schema, still
  warning by default and fatal under `strict`.
- **A wider parity test.** `packages/servers/openapi-mcp/test/parity.spec.ts` compares argument
  name, location, required-ness and body media type between the SDK catalog and the document
  catalog of the .NET test controllers. It does not compare argument schemas, and it does not yet run
  against a real backend that embeds the SDK.
- **Tests for the gateway's config refusals.** Plain HTTP without token exchange bound to a
  non-loopback host, token exchange on stdio (`token_exchange_requires_http`), and the choice
  between security alternatives have no tests.
- **A login credential source.** Listed under "Not specified" in
  [credentials.md](packages/http/spec/credentials.md).
- **Publishing the gateway.** `@liaiso/openapi-mcp` depends on the private `@liaiso/core`, and a
  published package may not depend on a private one. Either publish core or bundle it.
- **A route-normalisation conformance corpus.** Each SDK pins its own route folding with unit tests
  ([selection-hierarchy.md](packages/http/spec/selection-hierarchy.md), Known limits).

## Source servers

- **`pg-mcp`.** A PostgreSQL server over `@liaiso/db-core`, which already names no driver.
- **`docx-mcp` and `pptx-mcp`.** Further OOXML servers over `@liaiso/ooxml-core`. Moving media
  selection from path prefixes to content types is the generalisation they need; `excel-mcp` keeps
  its prefix so its result set does not change.

## llm-mcp

- **Several model hosts.** The chat product's agent gateway already queues worker calls per host
  (`products/chat/api/src/gateway/worker-lane.ts`); what is missing is more than one host to queue
  on, with round-robin and failover between them. Done when a second GPU halves the queue and one
  host going down moves its work to the other.
- **A savings record.** Measure worker time, verification and codex's repair together, so a
  delegation's cost is known rather than assumed.
- **A job model for large inputs.** Start and poll for work over 1 000 rows; `local_map` refuses more
  than 2 000 rows today.
- **Configuration knobs.** A model per `local_task` kind (only `LIAISO_LLM_MODEL` exists),
  `LIAISO_LLM_TOOLS` to register a subset of tools, `LIAISO_LLM_PROMPTS` to override the kind prompts
  (hard-coded in `src/tools/prompts.ts`), and throughput in `local_status`.
- **An OpenAI-compatible backend** for vLLM, llama.cpp and LM Studio. Only `src/backend/ollama.ts`
  exists; the port is `src/backend/port.ts`.
- **Delegation instruction templates.** AGENTS.md and CLAUDE.md templates in the README, and a
  deployment setting that swaps the chat product's `DELEGATION_INSTRUCTIONS` (hard-coded today),
  for example for a sensitive-data policy.

## Chat product: integrations

Today a user can add their own MCP server, connect with OAuth or without authentication, and call
its tools under invoke-time authorization ([connections/README.md](products/chat/api/src/connections/README.md)).

- **Partner integrations.** Registering a partner integration and publishing its scope-to-tool map.
  `IntegrationToolScope` is only read; nothing writes it.
- **Manifest auth capability.** A manifest that declares its auth mode and account linking.
  `Integration.manifestVersion` exists and is unused.
- **Consent versioning for the scope map.** A partner that moves a tool to a narrower scope widens
  every existing consent for it. Either store the manifest version with each granted scope and
  authorize against the version the user consented to, or force re-consent when a scope's tool list
  grows. Needed before partner scope publishing ships.
- **SDK-assisted delegated auth.** An adapter over a partner's own session or JWT system, so a
  backend that embeds the SDK can link accounts without running an OAuth server.
- **`liaiso auth` CLI.** `inspect`, `setup`, `test` and `publish` for partner onboarding.
- **PAT and API-key connections.** `IntegrationAuthMode` has only `oauth` and `none`.
- **An invocation audit trail.** `ConnectionEvent` records the connection lifecycle only; invocation
  denials are logged, not stored.
- **Credential key rotation.** `integration_authorization.key_version` is always `1` and
  `CHAT_AUTH_SECRET` is a single key.
- **A per-user tool-refresh lease.** The lease is keyed by integration alone, so one user's refresh
  suppresses another's on a shared partner integration.

## Chat product: tool approval

- **Use-count grants** ("the next five calls"). No speculative column: adding a nullable column is
  instant on PostgreSQL 17. Decrement in memory inside the per-turn closure `gateFor` already returns
  and write once when the turn settles, so the gate keeps one read per turn and no write per call; a
  crashed turn overshoots by at most the step budget.
- **Argument-bound grants.** A remembered grant covers every argument today. Mark which input fields
  are part of a tool's identity and bind the grant to those fields only. For a remote tool the server
  does not say which fields those are, so this may not be solvable there.

## Parked

Cheap, but nobody has asked for them.

- A per-tool digest in `load_tool`, so a client can tell whether a tool it loaded earlier changed.
