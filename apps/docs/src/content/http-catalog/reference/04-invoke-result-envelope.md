# Invoke result envelope

`invoke_tool` returns one of three things: a success, an error your backend produced, or an error
sk-mcp produced before your backend was reached. Telling the last two apart is what this page is
for.

> **Source of truth.** The success and backend-error shapes are
> [`invoke-result.schema.json`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/spec/schemas/invoke-result.schema.json),
> and the code meanings and leak rules are normative in
> [`packages/spec/error-mapping.md`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/spec/error-mapping.md);
> where they differ from this page, they win.

## Two layers

| Layer          | Produced                                | Has `status` | Codes                                         |
| -------------- | --------------------------------------- | ------------ | --------------------------------------------- |
| Backend-mapped | After your pipeline ran and responded   | Yes          | Nine `BackendErrorCode` values, in the schema |
| SDK-side       | Before dispatch, from the tool's schema | **No**       | Eight, in code only                           |

The presence or absence of `status` is the discriminator. It is the one thing to branch on: an
envelope with a `status` describes what your backend did; an envelope without one describes what
sk-mcp refused to send.

## Success

```json
{
  "status": 200,
  "body": {
    "id": 1,
    "item": "mechanical keyboard",
    "quantity": 2,
    "owner": "alice"
  }
}
```

`status` and optionally `body`, `contentType` and `location`. `isError` is absent, not `false`.

## Backend-mapped errors

```json
{
  "error": "validation_failed",
  "message": "The backend rejected one or more arguments. Fix the listed fields and call the operation again.",
  "status": 400,
  "retryable": false,
  "fields": [
    {
      "name": "quantity",
      "message": "The field Quantity must be between 1 and 100."
    }
  ]
}
```

`error`, `message`, `status` and `retryable` are always present. `fields` appears for field-level
validation failures — a field may be listed more than once, once per failed rule.
`retryAfterSeconds` appears with a `429` when the backend supplied it, and `reference` carries a
correlation id when one survived the leak filter.

The nine codes and the statuses they map from are in the schema and the spec table. `retryable` is
derived, not guessed: it is `true` only for `408`, `429`, `502`, `503` and `504`.

`retryable: false` means replaying the identical request will fail identically. It does not mean
the operation is unusable — a repaired `validation_failed` call is a new request. See
[how to recover from a validation error](/docs/http-catalog/recover-from-a-validation-error).

## SDK-side errors

These never reached your backend, so there is no HTTP status to report:

```json
{
  "error": "unknown_argument",
  "message": "Unknown argument(s): bogus. Allowed: id.",
  "retryable": false
}
```

```json
{
  "error": "unknown_tool",
  "message": "No operation named 'nope'. Use search_tools to find the exact name.",
  "retryable": false
}
```

```json
{
  "error": "invalid_path_type",
  "message": "Argument 'id' must be of type integer.",
  "retryable": false
}
```

The eight codes are `unknown_argument`, `invalid_path_type`, `missing_path_parameter`,
`header_injection`, `null_not_allowed`, `invalid_type`, `unknown_tool` and `not_invocable`.

This list is deliberately not tabulated with meanings here. Unlike the backend codes it has no
schema and no spec table yet — it lives in
[`errors.ts`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/core/src/errors.ts)
and the SDKs' argument exceptions, and this page will not become its de facto registry. Pinning it
in the spec is open work.

Argument checking happens **before** dispatch: `invoke_tool` composes the request as a dry run
first, so a schema mismatch is rejected without your backend seeing a request at all.

## Leak prevention

Error messages are filtered before an agent sees them. The filter strips content matching stack
frames, exception type names, file paths, connection strings and credential-shaped values, and
truncates anything over 1000 characters.

This is why a `500` reaches the agent as a short mapped message rather than your exception text,
and why a message may say details were withheld. The filter runs on messages sk-mcp forwards; it
is not a substitute for not putting secrets in error text.
