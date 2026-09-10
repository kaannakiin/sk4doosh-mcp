# How to recover from a validation error

This page is for whoever writes the agent side. `invoke_tool` came back as an error; you want the
agent to fix its arguments and try again instead of giving up or asking a human.

## Read the envelope

Every meta-tool result is JSON serialized into a single text content block, so the first step is
always the same:

```ts
const result = await client.callTool({
  name: "invoke_tool",
  arguments: { name, arguments: args },
});
const payload = JSON.parse(result.content[0].text);
```

`result.isError` tells you something went wrong; `payload.error` tells you what.

## Repair from `fields`, and only from `fields`

A `validation_failed` payload carries the per-field reasons:

```json
{
  "error": "validation_failed",
  "message": "The backend rejected one or more arguments. Fix the listed fields and call the operation again.",
  "status": 400,
  "retryable": false,
  "fields": [
    { "name": "item", "message": "The Item field is required." },
    {
      "name": "item",
      "message": "The field Item must be a string or array type with a minimum length of '1'."
    },
    {
      "name": "quantity",
      "message": "The field Quantity must be between 1 and 100."
    }
  ]
}
```

Two properties of that list matter for a retry loop.

A field can appear more than once, once per failed rule — `item` above failed both presence and
minimum length. Fix all of its messages, not the first one.

`retryable: false` refers to _replaying the same request_, which will fail identically. It does
not mean the operation is unusable. A repaired call is a new request, and it is expected to
succeed:

```json
{
  "status": 200,
  "body": { "id": 3, "item": "sample", "quantity": 1, "owner": "alice" }
}
```

Repair from `fields` rather than from `message`. The message is prose for a human; the field list is
the machine-readable part, and it is the only part that names what to change.

## Tell an SDK rejection apart from a backend one

Some errors never reach your backend: sk-mcp validates the arguments against the tool's schema
first and rejects locally. Those envelopes have **no `status` field**, and that absence is the
discriminator:

```json
{ "error": "unknown_argument", "message": "...", "retryable": false }
```

An error with a `status` came from your backend and was mapped. An error without one was produced
before dispatch — the argument names or types do not match the schema you loaded, so re-read the
schema with `load_tool` instead of retrying.

The codes that arrive without a `status` are `unknown_argument`, `invalid_path_type`,
`missing_path_parameter`, `header_injection`, `null_not_allowed`, `invalid_type`, `unknown_tool`
and `not_invocable`. The full envelope shape is on the
[invoke result envelope](/docs/http-catalog/invoke-result-envelope) page.

## Do not retry every error

`retryable` is set by sk-mcp from the mapped status, and it is the flag to branch on. Only
`408`, `429`, `502`, `503` and `504` are retryable; a `429` may also carry `retryAfterSeconds`.

Everything else needs a different call or a different caller, not a second attempt. A `forbidden`
will not become allowed by repeating it, and neither will an `unauthenticated` — sk-mcp forwarded
the caller's credential unchanged, so the same session cannot do better.

## Verify the loop

The example client ships this exact loop as a scenario. It generates deliberately invalid arguments
from the loaded schema, asserts the envelope, repairs using only `fields`, and calls again:

```bash
node apps/example-agent-client/dist/main.js --scenario validation-retry
```

It exits `0` when the repaired call returns a `2xx`, and `1` if any assertion fails — including its
check that no error message leaked a stack frame, a file path or a connection string.
