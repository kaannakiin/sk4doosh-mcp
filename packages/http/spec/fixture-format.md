# Conformance Fixture Format

> Status: **normative** — validated by two independent implementations (three runners read the corpus: `packages/http/core`, `sdks/nestjs`, `sdks/dotnet`).

Fixtures live under [packages/http/conformance](../conformance); every SDK's test suite reads the same JSON files directly and MUST pass them. The machine-readable schema is [schemas/fixture.schema.json](schemas/fixture.schema.json).

## Envelope

```json
{
  "kind": "naming | metadata-extraction | argument-mapping | selection | visibility | search | error-mapping | schema-simplification | card | detail",
  "description": "what the fixture tests",
  "input": {},
  "expected": {}
}
```

## Kinds

- `kind: "naming"` — `input.endpoints`: the set of endpoints entering naming (`operationId?`, `method`, `route`). `expected` is one of two shapes: `{"names": [...]}` (in the same order as `endpoints`) or `{"error": "name_collision" | "invalid_name"}`. It is given as a set because a collision is a property of the set, not of a single endpoint.
- `kind: "metadata-extraction"` — `input`: a complete `EndpointDescriptor`; `expected`: a complete `ToolDefinition`, or `{"tools": [...]}` when the descriptor declares variants, or `{"error": ...}`. An optional sibling `foldedRoutes` lists routes folded away from `input.route`, which spares a curation that resolves only on one of them; an optional sibling `files.refDescription` binds a file resolver, so file arguments offer `ref`. When the body is not JSON the runner also builds the request template, because every body-shape rejection lives there. Curation rules: [argument-curation.md](argument-curation.md).
- `kind: "argument-mapping"` — `input`: `{template, arguments}` (the template being method/route/parameter declarations — each optionally carrying `array`, `style` and `explode`, and an object-valued one carrying `members` and an optional `notation` — plus a body declaration, and optionally a `contentType`, the typed `form` fields of a form or multipart body, and the `fileSources` a file argument may use); `expected`: `{pathAndQuery, headers?, contentType?, bodyJson? | bodyText? | bodyForm? | bodyParts?}` — at most one body, the one matching the media type, which `validate.mjs` checks — or `{"error": "unknown_argument" | "invalid_path_type" | "missing_path_parameter" | "header_injection" | "null_not_allowed"}`. A parameter may also carry `as` and `fill`, the body a `curation` list, and the input a `deferred` map of resolved source values and a `maxInlineFileBytes` budget. Rules: [argument-mapping.md](argument-mapping.md), [argument-curation.md](argument-curation.md).
- `kind: "selection"` — `input`: `{default, operations[]}` (each operation carrying `id` plus `container?` / `operation?` markers); `expected`: `{"selected": [...]}` or `{"error": "ambiguous_selection"}`. Rules: [selection-hierarchy.md](selection-hierarchy.md).
- `kind: "visibility"` — `input`: `{auth, caller}` (`auth`: three-valued `anonymous`, `policies`, `imperative`; `caller`: three-valued `identity`, `policyResults`); `expected`: `{"decision": "allow" | "deny" | "unknown"}`. Rules: [visibility.md](visibility.md).
- `kind: "search"` — `input`: `{tools[], query, tags?}` (each tool carrying `name` plus `route`, and optional description fields; an optional `inputSchema` is carried raw and projected to the `parameters` field by the runner, so every implementation exercises the projection; an optional `groupedParameters` names the root properties the descriptor declared `deepObject`, whose members the projection indexes one level down; the optional `tags` list is the `search_tools` tag filter — an argument of the search, not a property of any one tool); `expected`: `{"names": [...]}` in the expected order. Rules: [search-semantics.md](search-semantics.md).
- `kind: "schema-simplification"` — `input`: `{shape, options?}` (`shape` being a [TypeShape](schemas/type-shape.schema.json); `options` being host policy: `dropReadOnlyProperties`, `maxDepth`); `expected`: `{schema, diagnostics?, defsOrder?}`. `diagnostics` lists the diagnostic codes emitted during production; when omitted, no diagnostic is expected at all. `defsOrder` is the exact order of the `$defs` keys and appears only in hoisting fixtures — the order is tested separately because neither runner's deep equality sees object key order. Rules: [schema-conversion-rules.md](schema-conversion-rules.md).
- `kind: "card"` — `input`: `{tool, decision?}` (`tool` being a complete `ToolDefinition`; `decision` being the three-valued visibility decision, defaulting to `allow`); `expected`: `{name, description, parameters, authUncertain?}`. Rules: [search-semantics.md](search-semantics.md), "The compact card".
- `kind: "detail"` — `input` is the `card` input exactly: `{tool, decision?}`. `expected`: `{name, description, inputSchema, outputSchema?, annotations, authUncertain?}` — the shape `load_tool` returns and `search_tools` returns per result under `detail: "schema"`. One corpus pins both, because one projection serves both. The `search` kind is unaffected by `detail`: it fixes ranking, and its `expected` stays a name list. Rules: [search-semantics.md](search-semantics.md), "The loaded shape".
- `kind: "error-mapping"` — two input forms, and which one a fixture uses decides which function runs. A `BackendResponseSpec` (`status`, `contentType?`, `headers?`, `body?`, `knownFields?`, `fieldAliases?`, `hiddenFields?`) drives the response mapper; an `SdkErrorSpec` (`sdkError`, plus `message?`, `bytes?`, `limit?`, `payload?`, `limitMs?`, `narrowing?`, `field?`, `reason?`) drives the SDK-side builders. `expected`: an `InvokeSuccess`, `MappedError` or `SdkError` conforming to [invoke-result.schema.json](schemas/invoke-result.schema.json). Rules: [error-mapping.md](error-mapping.md) and [invoke-semantics.md](invoke-semantics.md).

## Rules

- File layout: `conformance/{kind}/{descriptive-name}.json`; one file is one fixture.
- Field names are in English; `description` contents are free-form.
- Fixtures are validated against the schema: `pnpm validate` (from the root) or `pnpm --filter @sk-mcp/conformance validate`.
- If a schema change breaks fixtures, both are updated in the same change; fixtures MUST NOT be "fixed" on their own.
