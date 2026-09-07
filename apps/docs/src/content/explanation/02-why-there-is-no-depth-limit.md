# Why there is no depth limit

sk-mcp used to cut object graphs at three levels. It no longer does, and the reason is worth
recording, because the old behaviour looked prudent and was actually lossy.

## What the limit cost

A four-level DTO produced this at the fourth level:

```json
{ "type": "object", "additionalProperties": true }
```

That is honest — it says "an object, shape unknown" — but the leaf field simply never reached the
agent. The agent could still send a body, and the backend would still validate it, so nothing
crashed. Information was lost quietly, which is the worst failure mode for a discovery layer: the
tool looks complete.

The same collapse happened to any cycle. A self-referencing `Node` lost its `child` shape entirely.

And there was a third cost nobody had measured: a type used by two members was written out **twice,
byte for byte**. The schema grew with the number of _uses_, not the number of _types_.

## Why the limit existed

Termination. Without a bound, a recursive type expands forever. A depth counter is the cheapest way
to guarantee the writer stops.

But it is not the only way, and it is the wrong one. Depth is a proxy: it bounds recursion by
bounding _everything_, including the shallow non-recursive graphs that were never a risk.

## What replaced it

Cycles are expressed with `$defs` and `$ref`, the core vocabulary of JSON Schema. Termination now
comes from the `$defs` table itself: each named type is written at most once, so a finite type graph
always finishes, at any depth.

This also fixes the duplication. A type used more than once is hoisted into `$defs` and referenced,
so the schema grows with the number of distinct types.

## The objection we rejected

The argument against `$ref` was that an agent might not resolve it — that a weaker model would read
`{"$ref": "#/$defs/Address"}` and learn nothing.

We rejected it. An SDK cannot lower the fidelity of its output based on an assumption about the
quality of somebody else's agent. `$defs`/`$ref` is standard JSON Schema, MCP's `inputSchema` is
plain JSON Schema, and the alternative destroys information that is cheaply representable. If a
client's model struggles with references, that is a client problem with a client fix; a lossy schema
is a problem with no fix at all.

One real hazard stays on the record: `description` next to a `$ref` is evaluated in JSON Schema
2020-12 and ignored in draft-07. A client on an older validator drops descriptions on hoisted types,
and descriptions are the most valuable thing an agent reads. The sibling form is pinned by fixture
so that a change here is visible rather than accidental.

## What survived

`MaxDepth` still exists as an off-by-default host budget, because hoisting bounds _recursion_ and
not _breadth_: dozens of distinct single-use DTOs still expand into one large schema. That is a
context-size question, which varies by deployment, so it is a knob rather than a rule — and no SDK
is allowed to depend on its default.
