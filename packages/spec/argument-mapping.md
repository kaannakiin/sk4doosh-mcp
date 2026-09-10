# Argument Mapping

> Status: **validated by two implementations** (ASP.NET Core + NestJS/Express, 2026-08-28) — a normative candidate. The rules the second implementation forced us to revise are folded in below.

An agent's flat JSON arguments convert deterministically into an HTTP request. Input: a request template (method, route, parameter declarations with `in: path|query|header`, an optional body declaration) plus an argument object. Output: the path and query string, data headers, and an optional JSON body. Every SDK MUST produce **identical** output from the same input; the `argument-mapping/` fixtures in [conformance](../conformance) test exactly that.

## Template construction rules (at tool-production time, fail-fast)

- Argument names MUST be unique: parameter and body property names MUST NOT collide (including a path `id` plus a body `id` → error; the fix is a rename or an override). The synthetic body-root name (`body`) goes through the same check.
- `GET`/`HEAD` MUST NOT declare a body.
- A header-positioned parameter MUST NOT use an identity carrier name (`Authorization`, `Cookie`) — identity is never an argument.
- A path parameter MUST NOT be an array; every path parameter MUST have a `{name}` placeholder in the route (route constraints such as `{id:int}` are stripped in the template), and every placeholder MUST have a parameter.

## Composition algorithm (at call time, in order)

1. **Reject unknown fields:** an undeclared argument → an `unknown_argument` error whose message lists the permitted names. The allow-list is the parameter names plus the body fields plus the body-root argument, if any. Silent dropping is forbidden.
2. **Path:** every path parameter is required (`missing_path_parameter` when absent); a type gate applies (a value not matching the template's type → `invalid_path_type` — otherwise the route constraint would turn the error into an opaque 404); the value is percent-encoded and substituted into the placeholder. Encoding is **strict RFC 3986**: everything outside unreserved (`A-Z a-z 0-9 - . _ ~`) is encoded, including `!'()*` and the space (C#: `Uri.EscapeDataString`; JS: `encodeURIComponent` alone is not enough — `!'()*` are encoded separately; fixture: `percent-encoding-rfc3986`). **Raw concatenation is forbidden** — `"5/../admin"` becomes one encoded segment, which makes traversal structurally impossible.
3. **Query:** absent → the key is not written at all; `null` → `null_not_allowed`; an array → a repeated key in declaration order (`?tag=a&tag=b`); key and value are percent-encoded separately; parameters are written in declaration order, so the output string is deterministic.
4. **Header:** a CR/LF/NUL in a value → `header_injection`; data headers are applied AFTER identity carriers (a collision is already impossible thanks to the template rule).
5. **Body — two modes.** _Field mode_ (declared body fields): declared fields not bound to parameters are collected into a single JSON object. _Root mode_ (when the template declares a body-root argument, [schema-conversion-rules.md](schema-conversion-rules.md) Table 6): that argument's value is **the entire body** — it may be an array, a string, a number or a bool; if the argument is absent, no body is sent and the backend's model binder decides (the same discipline as `absent-query-omitted`). The two modes MUST NOT be declared together in one template (`conflicting_body_modes`). In both modes: `Content-Type: application/json; charset=utf-8` plus `Content-Length`.

## Value formatting

- Number and bool conversion is **always invariant** (`1.5` MUST NEVER become `1,5`) and is a **canonical shortest** serialization: leftover notation in the source text is not preserved (`1.50` → `"1.5"`; fixture: `number-canonical-form`). The rationale: in languages that work with the parsed value (JS) there is no source text, and the canonical form is the natural intersection of the two languages. Magnitudes requiring exponential notation are not yet fixture-pinned — an unpinned area.
- The type gate produces `invalid_type` in positions other than the path: when the argument object is not a JSON object, when a non-array value arrives for a parameter declared as an array, or when a scalar conversion fails. For the `integer` type: a fractional value, or one outside the safe integer range (|n| ≤ 2^53−1) → `invalid_type`; `1.0` is an integer → `"1"`. (The previous "64-bit" limit was not representable in JS; the rule was pulled back to the intersection.)
- Semantic validation (ranges, formats, business rules) is NOT the SDK's job — the backend's own validation runs; the SDK only performs safe composition.
