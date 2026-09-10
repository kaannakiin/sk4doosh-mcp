# @sk-mcp/spec

The normative specification for sk-mcp: prose plus the JSON Schemas that every language's
types are generated from.

`private: true`, version `1.0.0`, never published. It is consumed as a `workspace:*` dependency by
the type generators. If you are reading this you are changing the spec, not installing it.

## Read the status banner first

Every `.md` file here opens with a `> Status:` line, and the values are **not uniform**. Do not
treat a file as binding without reading it.

| File                         | Subject                                          | Status                                   |
| ---------------------------- | ------------------------------------------------ | ---------------------------------------- |
| `metadata-contract.md`       | `EndpointDescriptor`, `Auth`, `ToolDefinition`   | normative, two implementations           |
| `naming.md`                  | Tool naming, container prefixes, collisions      | normative, two implementations           |
| `selection-hierarchy.md`     | Selection layers and precedence                  | normative, two implementations           |
| `visibility.md`              | Visibility decision, three-valued semantics      | normative, two implementations           |
| `search-semantics.md`        | Search-first contract, tokenization, cards       | normative, two implementations           |
| `error-mapping.md`           | Error envelope, code dictionary, leak prevention | normative, two implementations           |
| `transport.md`               | Streamable HTTP, PRM, the 401 rule               | normative, two implementations           |
| `fixture-format.md`          | Fixture envelope and kinds                       | normative, two implementations           |
| `schema-conversion-rules.md` | TypeShape → JSON Schema                          | **rule layer normative, binding partly** |
| `caching.md`                 | Cache key, namespace, TTL, invalidation          | **partly normative**                     |
| `argument-mapping.md`        | Flat arguments → HTTP request                    | **normative candidate**                  |

The three highlighted rows are the ones that bite. `schema-conversion-rules.md` has an
"Unpinned areas" section listing behaviour that is deliberately not settled; `argument-mapping.md`
is validated by two implementations but not yet declared normative.

The prose is English, like the documentation site that links to it. The design documents under
repo-root `docs/` remain Turkish.

## Schemas

`schemas/` holds the machine-readable half, and it is the source of truth for all languages:

```text
endpoint-descriptor.schema.json   tool-definition.schema.json
invoke-result.schema.json         type-shape.schema.json
fixture.schema.json
```

Types are generated from these — never written by hand:

```bash
pnpm turbo run gen
```

That writes `packages/core/src/generated/` and
`sdks/dotnet/src/SkMcp.AspNetCore/Generated/`. Both are committed; both are off-limits to manual
edits.

Two schema constraints, enforced by the generator's limits: `$id` must equal the file name, and
`prefixItems`, `unevaluatedProperties`, `$dynamicRef` and `dependentSchemas` are unsupported.

## Changing the spec

RFC 2119 keywords — `MUST`, `SHOULD`, `MAY` — appear **only** in this directory. Nowhere else in
the repository, and never on the docs site.

To claim `normatif` a rule needs a fixture in [`../conformance`](../conformance) and two
independent implementations passing it. A rule change that does not move a fixture has not been
made; if a schema change breaks fixtures, update them in the same commit.

## Related

- [`../conformance`](../conformance) — the fixture corpus that pins these rules
- [`../core`](../core) — the TS reference implementation
- `apps/docs` — the public site. **Site pages must not restate normative rules; they link here.**
- [`../../apps/docs/dokuman-kurallari.md`](../../apps/docs/dokuman-kurallari.md) — the binding
  convention for anyone writing those pages
