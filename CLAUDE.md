# sk-mcp

"Swagger for Agents": an MCP layer embedded into existing backends — spec + SDK per language. Do not write code before understanding the architecture: [docs/00-genel-bakis.md](docs/00-genel-bakis.md), [docs/nasil-calisiyor.md](docs/nasil-calisiyor.md), [docs/paket-yerlesimi.md](docs/paket-yerlesimi.md). Phase plans and notes: [docs/fazlar/](docs/fazlar/).

## Package Boundaries

| Package                | Role                                                              | Rule                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/spec`        | Normative spec: Turkish prose + `schemas/*.schema.json`           | No runtime code; schemas are the single source of truth for all languages                                                                                                                                                                               |
| `packages/conformance` | Pure JSON fixture corpus + `validate.mjs`                         | SDKs read JSON from paths; no runtime dependencies may be added here                                                                                                                                                                                    |
| `packages/core`        | TS reference implementation (including composer/template runtime) | Types for spec concepts are GENERATED via `pnpm gen`; never write them manually                                                                                                                                                                         |
| `packages/excel-mcp`   | Standalone, publishable MCP server that reads local Excel files   | Not a core consumer: `EndpointDescriptor` is HTTP-only. Publishable shape (`bin`, `files`, `publishConfig`, `exports.types → dist`) deviates from the internal convention on purpose; see [decision 005](docs/kararlar/005-excel-okuma-semantikleri.md) |
| `sdks/*`               | Language SDKs (dotnet, nestjs)                                    | Do not put SDKs under `packages/`; the NestJS synthetic context is created by the SDK — `light-my-request` is FORBIDDEN (it poisons Express, see [decision 004](docs/kararlar/004-nestjs-dogrulamasi.md))                                               |

## Immutable Rules

- **Single source of truth**: Never manually define TS/C# types for spec concepts (`EndpointDescriptor`, `ToolDefinition`, `Fixture`, `Auth`, etc.). Change the schema → run `pnpm turbo run gen` → use the generated types. Never manually modify files under `packages/core/src/generated/` or `sdks/dotnet/src/SkMcp.AspNetCore/Generated/`; they are committed to the repository.

- `packages/core/src/index.ts` may only re-export `export type` from the canonical files. Never re-export the embedded `EndpointDescriptor`/`ToolDefinition` copies from `generated/fixture.ts` (single-definition rule).

- In schemas, `$id` ≡ the file name. The following 2020-12 keywords must not be used: `prefixItems`, `unevaluatedProperties`, `$dynamicRef`, `dependentSchemas` (the code generator does not support them).

- If a schema change breaks fixtures, update the fixtures in the same change.

- **No comments**: No comment lines in code or JSON. Put explanations in the spec prose or documentation.

- **Language**: Prose documentation is in Turkish; everything machine-readable (JSON fields, tool names, code identifiers) is in English.

- Always build core through Turbo (`pnpm turbo run build`) — `pnpm --filter @sk-mcp/core run build` skips generation and risks using stale types.

- Silent conflict resolution in tool naming is forbidden: a conflict is an error ([packages/spec/isimlendirme.md](packages/spec/isimlendirme.md)).

- Visibility ≠ enforcement: search filtering is not a security mechanism; enforcement must always happen in the backend pipeline at invoke time.

## Commands

- `pnpm build` / `pnpm lint` (includes validation) / `pnpm check-types` / `pnpm validate`

- TS tests: `pnpm --filter @sk-mcp/core test` / `pnpm --filter @sk-mcp/sdk-nestjs test` (Vitest)

- dotnet side: `pnpm turbo run build --filter=@sk-mcp/sdk-dotnet` (the shim invokes `dotnet build`)

- DemoApi: `dotnet run` — located in `sdks/dotnet/samples/DemoApi`, listens on `http://127.0.0.1:5178`; MCP endpoint `/mcp` (requires a bearer token); demo shortcut `POST /auth/token {"user":"alice"|"bob"|"carol"}`; full OAuth 2.1 flow via the in-repo `samples/DemoAuthServer` mounted at `/oauth` (PRM at `/.well-known/oauth-protected-resource/mcp`)

- example-agent-client: `node apps/example-agent-client/dist/main.js --scenario smoke|validation-retry|error-envelope`; `SKMCP_AUTH=oauth|token|bearer` (`bearer` reads `SKMCP_TOKEN`, for a real backend), `SKMCP_USER`, `SKMCP_BASE_URL`

- Nest demo: located in `sdks/nestjs/samples/demo-api`; run with `node dist/main.js` (first run `pnpm turbo run build --filter=@sk-mcp/demo-nestjs`); same `/mcp` + `/auth/token` contract

- Docs site: located in `apps/docs` (TanStack Start + Mantine + Tailwind); run with `pnpm --filter @sk-mcp/docs dev`, listens on `http://localhost:5180`; pages are markdown under `src/content/*.md`. This site is sk-mcp's public face, so its content and UI strings are written in **English** — the Turkish-prose rule applies to `docs/` and `packages/spec/`, not here. There is no i18n layer by design.
