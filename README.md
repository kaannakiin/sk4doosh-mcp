# sk-mcp

Swagger for agents. An MCP layer that embeds into a backend you already have: it exposes your
endpoints as a search-first tool catalog and replays each agent call through the backend's **own
request pipeline**. Enforcement stays wherever it already lives — sk-mcp neither copies nor
rewrites your authorization logic.

The spec is language-neutral. Each language's SDK validates itself against the same fixture corpus,
so parity is a test result rather than a claim.

## Where to start

- **Use it in an ASP.NET Core backend** — [sdks/dotnet/README.md](sdks/dotnet/README.md)
- **Use it in a NestJS backend** — [sdks/nestjs/README.md](sdks/nestjs/README.md)
- **Read the docs site** — `apps/docs`, run with `pnpm --filter @sk-mcp/docs dev`
  (`http://localhost:5180`)
- **Work on the chat product** — `products/chat`, run with `pnpm dev:chat`
  (web `http://localhost:5190`, api `http://127.0.0.1:5191`)

## Repository map

| Path                                                                 | Role                                                                                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [packages/spec](packages/spec)                                       | Normative spec: English prose + `schemas/*.schema.json`. The single source of truth, all languages               |
| [packages/conformance](packages/conformance)                         | Pure JSON fixture corpus (9 kinds, 140 fixtures) + `validate.mjs`                                                |
| [packages/core](packages/core)                                       | TS reference implementation; spec types are generated, never hand-written. Internal                              |
| [sdks/dotnet](sdks/dotnet)                                           | C# SDK — `SkMcp.AspNetCore`, public alpha ([README](sdks/dotnet/README.md))                                      |
| [sdks/nestjs](sdks/nestjs)                                           | NestJS SDK — discovery, search and visibility shipped; internal, not published ([README](sdks/nestjs/README.md)) |
| [sdks/nestjs/samples/agent-client](sdks/nestjs/samples/agent-client) | Scenario-driven MCP client (smoke, validation-retry, error-envelope)                                             |
| [packages/file-core](packages/file-core)                             | Published shared machinery for read-only, sandboxed, file-backed MCP servers                                     |
| [packages/excel-mcp](packages/excel-mcp)                             | Standalone published product: an MCP server that reads local Excel workbooks                                     |
| [packages/xml-mcp](packages/xml-mcp)                                 | Standalone published product: an MCP server that reads local XML documents                                       |
| [apps/docs](apps/docs)                                               | The documentation site. English, and the project's public face                                                   |
| [products/chat/contracts](products/chat/contracts)                   | Shared zod schemas of the chat product, consumed by both its api and its web app                                 |
| [products/chat/api](products/chat/api)                               | NestJS 12 chat backend, localized (`en`, `tr`)                                                                   |
| [products/chat/web](products/chat/web)                               | TanStack Start + Mantine + Tailwind chat frontend, localized (`en`, `tr`)                                        |

`packages/eslint-config` and `packages/typescript-config` are internal configuration packages.
`packages/xml-lab` is an evidence harness with no shipping surface.

The HTTP catalog (`packages/core`, both SDKs) and the file-backed servers (`packages/file-core`,
`excel-mcp`, `xml-mcp`) are two separate product shapes that share no runtime code path. One is a
library you embed in your backend; the others are servers you run against local files.

`products/chat` is a third line, and it shares only the toolchain: no `packages/*` or `sdks/*`
package may depend on `@chat/*`. The scope is the filter — `--filter='@chat/*'` and
`--filter='!@chat/*'` partition the repo, and the two lines have independent CI workflows.

## Build and test

```bash
pnpm install
pnpm build          # turbo run build
pnpm lint           # lint + conformance fixture validation + content checks
pnpm check-types
```

TS tests run through turbo so `^build` resolves:
`pnpm turbo run test --filter=@sk-mcp/core`, `--filter=@sk-mcp/sdk-nestjs` (Vitest).
The C# side: `pnpm turbo run test --filter=@sk-mcp/sdk-dotnet` (net8.0 + net10.0).

Per product line: `pnpm dev:chat` / `pnpm build:chat` for the chat product, `pnpm dev:sk` /
`pnpm build:sk` for everything else. `pnpm boundaries` checks that the two lines stay apart.

Spec types are generated. Change the schema, then run `pnpm turbo run gen`.
`packages/core/src/generated/` and `sdks/dotnet/src/SkMcp.AspNetCore/Generated/` are committed and
never hand-edited.

## Documentation and language

The site under `apps/docs` and the spec under `packages/spec` are written in **English** — the site
is sk-mcp's public face and the spec is what it links to as normative. The design records under
`docs/` stay **Turkish**: they are internal, and the ADRs there are immutable. Site pages describe
and link; the spec binds. `apps/docs` carries no i18n layer, by design; `products/chat` is localized (`en`, `tr`).

Anyone editing the site is bound by [apps/docs/dokuman-kurallari.md](apps/docs/dokuman-kurallari.md).

## License

MIT — [LICENSE](LICENSE).
