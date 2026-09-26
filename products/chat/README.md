# Chat

A separate product line built on top of the liaiso toolchain, sharing only the shared config
packages (`@liaiso/oxlint-config`, `@liaiso/typescript-config`). It is a chat application whose
backend reaches local and remote MCP servers — including this repository's own — through a coding
agent, localized in English and Turkish.

## Running it

```bash
pnpm dev:chat
```

This is `turbo run dev dev:types --filter='@chat/*'`, which starts every `@chat/*` package in
watch mode together: `@chat/contracts` (`tsc --watch`), `@chat/api` on `http://127.0.0.1:5191`,
and `@chat/web` on `http://localhost:5190`. `pnpm dev:sk` is the complement, for working on the
liaiso line without the chat processes running.

Environment comes from `products/chat/api/.env` and `products/chat/web/.env`, loaded by
`@nestjs/config` and Vite respectively — Turbo runs in strict env mode and does not load `.env`
files itself. Each directory has a `.env.example` to copy from; `@chat/api`'s covers session auth,
OAuth provider credentials, PostgreSQL, Redis, S3-compatible storage, the LLM provider, and the
Codex coding agent (see the comments in that file for what each variable does and what it
defaults to). `@chat/web`'s only variable is `VITE_CHAT_API_URL`, needed only when the API is not
reached through the dev server's own origin.

## Packages

| Package                                | Role                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contracts`                            | The product's contract layer: every zod schema, one topic per file under a domain folder (`common/`, `chat/`, `http/`, `config/`). No barrel; consumers import a leaf subpath, e.g. `@chat/contracts/chat/send-message`. |
| `api`                                  | NestJS 12 backend, localized (`en`, `tr`). ESM, built with plain `tsc` (never `@nestjs/cli`). Validation is `@Body({ schema })` plus a global `ZodValidationPipe`; i18n is `i18next` behind an in-repo `I18nModule`.     |
| `queries`                              | The server-state layer: query keys, `queryOptions`, mutations and the AI SDK chat transport. `react`, `@tanstack/react-query` and `ai` are peers, not dependencies, so the app supplies one instance of each.            |
| `web`                                  | TanStack Start + Mantine + Tailwind frontend, localized (`en`, `tr`). Locale is carried by a `chat_locale` cookie, never in the URL.                                                                                     |
| `db` _(not in the root package table)_ | `@chat/db`: the Prisma schema and generated client `api` builds on (`pnpm turbo run gen --filter=@chat/db` before a build; `db:migrate`/`db:deploy`/`db:status` scripts).                                                |

## Boundary with the liaiso line

No package under `apps/*`, `packages/*` or `sdks/*` may depend on `@chat/*`
(`boundaries.tags.chat.dependents.allow: ["chat"]` in the root `turbo.json`, checked by
`pnpm boundaries`), and no source file under `products/chat/*/src` may import an `@liaiso/*`
product package. Both `@liaiso/sdk-nestjs` and `@chat/contracts` declare `zod` as a peer on the
4.x line, but nothing in the dependency graph keeps a version bump on one side in step with the
other; the boundary is what stops that from turning into two zod majors sharing one process.

## Further reading

- [`products/chat/api/src/connections/README.md`](api/src/connections/README.md) — how a
  signed-in user's connection to an external MCP server is authorized at invoke time, independent
  of platform login.
