# Conformance Fixture Format

> Status: **normative** — validated by two independent implementations (three runners read the corpus: `packages/core`, `sdks/nestjs`, `sdks/dotnet`).

Fixtures live under [packages/conformance](../conformance); every SDK's test suite reads the same JSON files directly and MUST pass them. The machine-readable schema is [schemas/fixture.schema.json](schemas/fixture.schema.json).

## Envelope

```json
{
  "kind": "naming | metadata-extraction | argument-mapping | selection | visibility | search | error-mapping | schema-simplification | card",
  "description": "what the fixture tests",
  "input": {},
  "expected": {}
}
```

## Kinds

- `kind: "naming"` — `input.endpoints`: the set of endpoints entering naming (`operationId?`, `method`, `route`). `expected` is one of two shapes: `{"names": [...]}` (in the same order as `endpoints`) or `{"error": "name_collision" | "invalid_name"}`. It is given as a set because a collision is a property of the set, not of a single endpoint.
- `kind: "metadata-extraction"` — `input`: a complete `EndpointDescriptor`; `expected`: a complete `ToolDefinition`.
- `kind: "argument-mapping"` — `input`: `{template, arguments}` (the template being method/route/parameter declarations plus a body declaration); `expected`: `{pathAndQuery, headers?, bodyJson?}` or `{"error": "unknown_argument" | "invalid_path_type" | "missing_path_parameter" | "header_injection" | "null_not_allowed"}`. Rules: [argument-mapping.md](argument-mapping.md).
- `kind: "selection"` — `input`: `{default, operations[]}` (each operation carrying `id` plus `container?` / `operation?` markers); `expected`: `{"selected": [...]}` or `{"error": "ambiguous_selection"}`. Rules: [selection-hierarchy.md](selection-hierarchy.md).
- `kind: "visibility"` — `input`: `{auth, caller}` (`auth`: three-valued `anonymous`, `policies`, `imperative`; `caller`: three-valued `identity`, `policyResults`); `expected`: `{"decision": "allow" | "deny" | "unknown"}`. Rules: [visibility.md](visibility.md).
- `kind: "search"` — `input`: `{tools[], query}` (each tool carrying `name` plus `route`, and optional description fields); `expected`: `{"names": [...]}` in the expected order. Rules: [search-semantics.md](search-semantics.md).
- `kind: "schema-simplification"` — `input`: `{shape, options?}` (`shape` being a [TypeShape](schemas/type-shape.schema.json); `options` being host policy: `dropReadOnlyProperties`, `maxDepth`); `expected`: `{schema, diagnostics?, defsOrder?}`. `diagnostics` lists the diagnostic codes emitted during production; when omitted, no diagnostic is expected at all. `defsOrder` is the exact order of the `$defs` keys and appears only in hoisting fixtures — the order is tested separately because neither runner's deep equality sees object key order. Rules: [schema-conversion-rules.md](schema-conversion-rules.md).
- `kind: "card"` — `input`: `{tool, decision?}` (`tool` being a complete `ToolDefinition`; `decision` being the three-valued visibility decision, defaulting to `allow`); `expected`: `{name, description, parameters, authUncertain?}`. Rules: [search-semantics.md](search-semantics.md), "The compact card".
- `kind: "error-mapping"` — `input`: a `BackendResponseSpec` (`status`, `contentType?`, `headers?`, `body?`, `knownFields?`); `expected`: an `InvokeSuccess` or `MappedError` conforming to [invoke-result.schema.json](schemas/invoke-result.schema.json). Rules: [error-mapping.md](error-mapping.md).

## Rules

- File layout: `conformance/{kind}/{descriptive-name}.json`; one file is one fixture.
- Field names are in English; `description` contents are free-form.
- Fixtures are validated against the schema: `pnpm validate` (from the root) or `pnpm --filter @sk-mcp/conformance validate`.
- If a schema change breaks fixtures, both are updated in the same change; fixtures MUST NOT be "fixed" on their own.
