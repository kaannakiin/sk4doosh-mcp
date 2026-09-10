# Schema conversion

An agent knows a tool only from its `inputSchema`. This page describes how a backend type becomes
that schema.

> **Source of truth.** The normative text is
> [`packages/spec/schema-conversion-rules.md`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/spec/schema-conversion-rules.md)
> and the shape it consumes is
> [`type-shape.schema.json`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/spec/schemas/type-shape.schema.json);
> where the two differ, the spec wins. Its "Unpinned areas" section lists binding-layer details
> that are not yet pinned — this page does not present those as settled.

## Two layers

Conversion is split, and the split is normative.

| Layer       | Input                                                        | Output        | Tested by                                   |
| ----------- | ------------------------------------------------------------ | ------------- | ------------------------------------------- |
| **Binding** | A language type (a CLR `Type`, a decorated TypeScript class) | A `TypeShape` | Each SDK's own host tests                   |
| **Rule**    | A `TypeShape`                                                | A JSON Schema | The shared `schema-simplification` fixtures |

The boundary sits where it does for one reason: you cannot hand a CLR `Type` to a JSON fixture, but
you can hand it a member list. Moving the boundary to `TypeShape` made 22 of the 34 conversion rules
language-independent and fixture-pinned. The 12 that remain in binding are the ones whose input
genuinely is a reflection handle.

`TypeShape` is defined by `packages/spec/schemas/type-shape.schema.json`. That schema is the source
of truth; this page does not restate its fields.

## Where each rule lives

Look up a behaviour by what you are asking about.

| Question                                             | Layer   | Pinned by                                                             |
| ---------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| Which CLR types are integers?                        | Binding | Host tests                                                            |
| Which JSON `type` does an integer produce?           | Rule    | `schema-simplification/binary-and-scalars.json`                       |
| Is a dictionary an object or an array?               | Rule    | `schema-simplification/map-before-array.json`                         |
| How is an enum's wire form discovered?               | Binding | Host tests                                                            |
| What schema does a flags enum produce?               | Rule    | `schema-simplification/enum-flags-omits-enum.json`                    |
| Does a read-only property appear in the schema?      | Rule    | `schema-simplification/readonly-members-drop-except-collections.json` |
| Does `[MinLength]` become `minLength` or `minItems`? | Rule    | `schema-simplification/constraints-size-forks-on-type.json`           |
| What happens to a recursive type?                    | Rule    | `schema-simplification/cycle-becomes-defs-ref.json`                   |

The fixtures are the tests. Every SDK reads the same JSON files and must produce byte-identical
output.

## Shared and recursive types

A named object type is written into `$defs` and referenced with `$ref` when it is used more than
once, or when it participates in a cycle. A type used exactly once and not in a cycle stays inline,
so a shallow DTO stays flat.

The root is always inline. `inputSchema` is always a plain object, because body members flatten to
the top level.

`$defs` keys are the simple type names, sorted in ordinal order. Two hoisted types that share a
simple name get a numeric suffix on the later one, and a diagnostic says so — nothing is resolved
silently.

Measured on a DemoApi endpoint:

```json
{
  "type": "object",
  "properties": {
    "item": { "type": "string", "description": "Item name", "minLength": 1 },
    "quantity": {
      "type": "integer",
      "description": "Quantity",
      "minimum": 1,
      "maximum": 100
    }
  },
  "required": ["item"],
  "additionalProperties": false
}
```

## Depth

There is no depth limit. Nesting expands fully; termination is guaranteed by the `$defs` table,
because each named type is written at most once.

`MaxDepth` survives as an optional host budget for context size, off by default. It is a policy, not
a rule: no SDK may depend on its default. When a host sets it, the cut emits
`{"type":"object","additionalProperties":true}` and a `schema_depth_truncated` diagnostic.

## Bodies that are not objects

MCP tool arguments are a JSON object, so a body whose root is an array or a scalar is wrapped in one
synthetic argument named `body`. Its value becomes the whole HTTP body.

```json
{
  "type": "object",
  "properties": { "body": { "type": "array", "items": { "type": "integer" } } },
  "required": ["body"],
  "additionalProperties": false
}
```

The name goes through the same collision check as any other argument. A parameter already called
`body` makes the endpoint fail with `argument_collision`.

## When the shape cannot be read

An unreadable shape is a warning, not a dropped endpoint. The schema becomes
`{"type":"object","additionalProperties":true}` and an `unreadable_shape` diagnostic names the type.
The tool stays callable with a weaker contract, because that boundary object also tells the request
composer to forward unknown keys.

If you would rather fail the catalog than ship an opaque body, escalate the code through your SDK's
diagnostics options.
