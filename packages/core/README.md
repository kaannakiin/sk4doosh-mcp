# @sk-mcp/core

The language-neutral reference implementation of the sk-mcp spec, in TypeScript.

**This is not a package you install.** `private: true`, version `0.0.0`, never published; it exists
as a `workspace:*` dependency of `@sk-mcp/sdk-nestjs` and nothing else. There is no version to pin
and no public API contract. If you are reading this you are changing it.

`core` is **not** `file-core`. This package is the HTTP catalog implementation;
[`../file-core`](../file-core) is the shared machinery for file-backed MCP servers. Neither depends
on the other, in either direction. The reasoning is in
[docs/paket-yerlesimi.md](../../docs/paket-yerlesimi.md).

## What lives here

One module per spec concept. The source is a click away, so this list points rather than describes.

| Area             | Files                                                |
| ---------------- | ---------------------------------------------------- |
| Naming           | `naming.ts`                                          |
| Selection        | `selection.ts`                                       |
| Tool assembly    | `tool.ts`, `tool-definition.ts`, `argument-names.ts` |
| Request path     | `request-template.ts`, `request-composer.ts`         |
| Schema pipeline  | `schema-simplification.ts`, `json-schema.ts`         |
| Search and cards | `search.ts`, `card.ts`                               |
| Visibility       | `visibility.ts`                                      |
| Errors           | `error-mapping.ts`, `leak-filter.ts`, `errors.ts`    |
| Cache            | `cache/`                                             |

`src/index.ts` is the barrel and may only re-export from the canonical file for each concept. In
particular it must never re-export the embedded `EndpointDescriptor` / `ToolDefinition` copies
inside `generated/fixture.ts` — one definition per type, from one place.

## Generated code

`src/generated/` is produced from [`../spec/schemas`](../spec/schemas) by
`scripts/generate-types.mjs` (`@apidevtools/json-schema-ref-parser` +
`json-schema-to-typescript`):

```bash
pnpm turbo run gen
```

Committed, and never hand-edited. Always build through turbo — `pnpm --filter @sk-mcp/core build`
skips generation and can compile against stale types.

## Tests and the conformance corpus

```bash
pnpm turbo run test --filter=@sk-mcp/core
```

`test/conformance-fixtures.spec.ts` runs the shared corpus in [`../conformance`](../conformance).
Core is one of three independent runners over those same JSON files, alongside
`packages/conformance/validate.mjs` and the .NET `CatalogFixtureTests`. That is what makes cross-SDK
parity a test result instead of an assertion.

A rule change that does not move a fixture has not been made.

## Relationship to the SDKs

`@sk-mcp/sdk-nestjs` depends on this package and re-exports the parts its users need, so NestJS
consumers never import core directly.

`SkMcp.AspNetCore` deliberately does **not** depend on it — it is an independent implementation in
C#, and it earns parity by passing the same fixtures. That independence is the point: a spec
validated by one implementation is a description of that implementation.

## Related

- [`../spec`](../spec) — the normative rules and the schemas types come from
- [`../conformance`](../conformance) — the fixture corpus
- `apps/docs` — the public documentation site (English)
