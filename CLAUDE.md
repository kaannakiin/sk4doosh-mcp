# sk-mcp

"Swagger for Agents": an MCP layer embedded into existing backends — spec + SDK per language. Do not write code before understanding the architecture: [docs/00-genel-bakis.md](docs/00-genel-bakis.md), [docs/nasil-calisiyor.md](docs/nasil-calisiyor.md), [docs/paket-yerlesimi.md](docs/paket-yerlesimi.md). Phase plans and notes: [docs/fazlar/](docs/fazlar/).

## Package Boundaries

| Package                | Role                                                                                                                                                                                                        | Rule                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/spec`        | Normative spec: Turkish prose + `schemas/*.schema.json`                                                                                                                                                     | No runtime code; schemas are the single source of truth for all languages                                                                                                                                                                                                                                                                                                                        |
| `packages/conformance` | Pure JSON fixture corpus + `validate.mjs`                                                                                                                                                                   | SDKs read JSON from paths; no runtime dependencies may be added here                                                                                                                                                                                                                                                                                                                             |
| `packages/core`        | TS reference implementation (including composer/template runtime)                                                                                                                                           | Types for spec concepts are GENERATED via `pnpm gen`; never write them manually                                                                                                                                                                                                                                                                                                                  |
| `packages/file-core`   | Published shared machinery for read-only, sandboxed, file-backed MCP servers: sandbox path resolution, listing, document cache, error envelope, cursor codec, format registry, tool registration, stdio CLI | **Not `packages/core`** and never depends on it in either direction — `core` is the HTTP catalog reference implementation. Published (not `private`) so `excel-mcp` can depend on it at runtime; `zod` and the MCP SDK are peers. Stays `0.x` until a second format server consumes it. The grid layer must not leak into it; see [decision 015](docs/kararlar/015-dosya-kaynagi-cekirdegi.md)   |
| `packages/excel-mcp`   | Standalone, publishable MCP server that reads local Excel files                                                                                                                                             | Not a `@sk-mcp/core` consumer: `EndpointDescriptor` is HTTP-only. Consumes `@sk-mcp/file-core`. Publishable shape (`bin`, `files`, `publishConfig`, `exports.types → dist`) deviates from the internal convention on purpose; see [decision 005](docs/kararlar/005-excel-okuma-semantikleri.md) and [decision 015](docs/kararlar/015-dosya-kaynagi-cekirdegi.md)                                 |
| `packages/xml-lab`     | F0 evidence harness for the XML engine gate: fixture generators, isolated probes, evidence collector                                                                                                        | `private: true` with **no `build` task**, so no `dist/` and no importable surface. Nothing may depend on it in either direction — `packages/xml-mcp` never imports it. Never added to the `pack` job. `libxml2-wasm` lives here as an **exact-pinned devDependency** only; a caret invalidates the F0-01 integrity record. Holds no product code; see [F0](docs/xml/fazlar/00-kanit-ve-karar.md) |
| `sdks/*`               | Language SDKs (dotnet, nestjs)                                                                                                                                                                              | Do not put SDKs under `packages/`; the NestJS synthetic context is created by the SDK — `light-my-request` is FORBIDDEN (it poisons Express, see [decision 004](docs/kararlar/004-nestjs-dogrulamasi.md))                                                                                                                                                                                        |

## Immutable Rules

- **Single source of truth**: Never manually define TS/C# types for spec concepts (`EndpointDescriptor`, `ToolDefinition`, `Fixture`, `Auth`, etc.). Change the schema → run `pnpm turbo run gen` → use the generated types. Never manually modify files under `packages/core/src/generated/` or `sdks/dotnet/src/SkMcp.AspNetCore/Generated/`; they are committed to the repository.

- `packages/core/src/index.ts` may only re-export `export type` from the canonical files. Never re-export the embedded `EndpointDescriptor`/`ToolDefinition` copies from `generated/fixture.ts` (single-definition rule).

- In schemas, `$id` ≡ the file name. The following 2020-12 keywords must not be used: `prefixItems`, `unevaluatedProperties`, `$dynamicRef`, `dependentSchemas` (the code generator does not support them).

- If a schema change breaks fixtures, update the fixtures in the same change.

- **No comments**: No comment lines in code or JSON. Put explanations in the spec prose or documentation.

- **Language**: Prose documentation is in Turkish; everything machine-readable (JSON fields, tool names, code identifiers) is in English.

- Always build core through Turbo (`pnpm turbo run build`) — `pnpm --filter @sk-mcp/core run build` skips generation and risks using stale types.

- Silent conflict resolution in tool naming is forbidden: a conflict is an error ([packages/spec/isimlendirme.md](packages/spec/isimlendirme.md)).

- `packages/file-core` carries **no format-specific vocabulary**. User-facing nouns arrive through the injected `Vocabulary`; error instances arrive through the injected `ErrorFactory`. A string literal saying "workbook", "sheet", "spreadsheet" or "excel" inside `packages/file-core/src` is a defect.

- A published package may never depend on a `private: true` workspace package. `pnpm publish` silently rewrites `workspace:^` to the private package's `0.0.0`, the publish succeeds, and the failure surfaces in the consumer's `install`. The CI `pack` job guards this ([.github/scripts/check-npm-tarballs.py](.github/scripts/check-npm-tarballs.py)).

- Visibility ≠ enforcement: search filtering is not a security mechanism; enforcement must always happen in the backend pipeline at invoke time.

## Commands

- `pnpm build` / `pnpm lint` (includes validation) / `pnpm check-types` / `pnpm validate`

- TS tests: `pnpm turbo run test --filter=@sk-mcp/core` / `--filter=@sk-mcp/file-core` / `--filter=@sk-mcp/excel-mcp` / `--filter=@sk-mcp/sdk-nestjs` (Vitest). Run them **through Turbo**, not `pnpm --filter <pkg> test`: that form skips `dependsOn: ["^build"]`, and `excel-mcp` resolves `@sk-mcp/file-core` through `exports.default → ./dist/index.js`, so a bare filter can test against a stale `dist`.

- dotnet side: `pnpm turbo run build --filter=@sk-mcp/sdk-dotnet` (the shim invokes `dotnet build`)

- DemoApi: `dotnet run` — located in `sdks/dotnet/samples/DemoApi`, listens on `http://127.0.0.1:5178`; MCP endpoint `/mcp` (requires a bearer token); demo shortcut `POST /auth/token {"user":"alice"|"bob"|"carol"}`; full OAuth 2.1 flow via the in-repo `samples/DemoAuthServer` mounted at `/oauth` (PRM at `/.well-known/oauth-protected-resource/mcp`)

- example-agent-client: `node apps/example-agent-client/dist/main.js --scenario smoke|validation-retry|error-envelope`; `SKMCP_AUTH=oauth|token|bearer` (`bearer` reads `SKMCP_TOKEN`, for a real backend), `SKMCP_USER`, `SKMCP_BASE_URL`

- Nest demo: located in `sdks/nestjs/samples/demo-api`; run with `node dist/main.js` (first run `pnpm turbo run build --filter=@sk-mcp/demo-nestjs`); same `/mcp` + `/auth/token` contract

- Docs site: located in `apps/docs` (TanStack Start + Mantine + Tailwind); run with `pnpm --filter @sk-mcp/docs dev`, listens on `http://localhost:5180`; pages are markdown under `src/content/*.md`. This site is sk-mcp's public face, so its content and UI strings are written in **English** — the Turkish-prose rule applies to `docs/` and `packages/spec/`, not here. There is no i18n layer by design.
