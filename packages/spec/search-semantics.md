# Search Semantics

> Status: **normative** — validated by two independent implementations (ASP.NET `ToolIndex` + TS `search.ts`; the compact card by the `card/` corpus, and the three meta-tools have the same wire form in both frameworks).

Defines the three meta-tools of search-first discovery and the ranking rules of `search_tools`. The machine-readable counterpart is the `search` fixture kind in [schemas/fixture.schema.json](schemas/fixture.schema.json); the corpus is [conformance/search/](../conformance/search/).

## Why search-first

`tools/list` returns only the three meta-tools. Hundreds of endpoints MUST NEVER enter the agent's context all at once; the agent searches, loads the schema of what it found, then calls. Because the list almost never changes there is no client cache problem; what varies is the search results, and those are fresh every time.

## Meta-tool contract

| Tool           | Input                                                           | Output                                                              |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| `search_tools` | `query: string` (may be empty), `limit: int` (1-50, default 20) | `{ total, results: Card[] }`                                        |
| `load_tool`    | `name: string`                                                  | `{ name, description, inputSchema, annotations }`                   |
| `invoke_tool`  | `name: string`, `arguments: object`                             | `InvokeSuccess`, or `CallToolResult.isError = true` + `MappedError` |

- In `search_tools` an empty query means **list**: every tool, ordinal sorted by name, up to `limit`. There is no separate `list` tool.
- `load_tool` output does **not** contain `auth` — [visibility.md](visibility.md) invariant 3: policy names MUST NOT leak to the agent. `load_tool` is subject to the visibility filter: for a hidden tool, its answer is identical to the answer for a nonexistent tool.
- In `search_tools` and `load_tool` output, `authUncertain: true` says the decision was `unknown`; `total` is the number of tools the declarative layer counted as visible (see below).
- `invoke_tool` MUST NOT consult the visibility filter ([visibility.md](visibility.md) invariant 1); enforcement is in the real pipeline. The result envelope and the error codes (the backend's HTTP errors, the SDK-side `unknown_tool`/`not_invocable`, and the argument codes from [argument-mapping.md](argument-mapping.md)) are normative in [error-mapping.md](error-mapping.md).
- The meta-tools' own descriptions are in English; that is the SDK's language, not the backend's.

## The compact card

```json
{
  "name": "get_order",
  "description": "Fetches one order by id.",
  "parameters": "id: integer (required)"
}
```

- `description`: the tool description; if it exceeds 160 characters it is cut at the last space and `…` is appended. If the cut point falls before half the budget, no word boundary is awaited.
- `parameters`: built from `inputSchema.properties` as `name: type`, with ` (required)` appended for entries in the `required` list; when there is no `type` (or a type union has no non-null member) it is `any`. Joined with a comma and a space. The full schema is in `load_tool`.
- Summary order: **integer-like property names first, in ascending numeric order; then the rest in declaration order.** The order rule is normative and matches ECMAScript's object key ordering — in JS, integer-like keys are already hoisted to the front when an object is constructed and declaration order cannot be recovered, so the rule itself has to be this order. The machine-readable counterpart is the `card` fixture kind in [schemas/fixture.schema.json](schemas/fixture.schema.json).

## Tokenization

The query and the document go through the same process:

1. Every character that is not a letter or a digit is a separator (Unicode; letters from any language are part of a word).
2. An intra-word uppercase boundary is a separator — the same rule as snake_case in [naming.md](naming.md): when the preceding character is lowercase, or the preceding is uppercase **and** the next is lowercase. `GetPortalPresence` → `get`, `portal`, `presence`; `getQRDetails` → `get`, `qr`, `details`.
3. Tokens are **folded**: NFD decomposition → dropping combining marks (`\p{Mn}`) → lowercasing → NFC recomposition. In that order, and on the token as a whole rather than character by character.
4. Tokens shorter than 2 characters are dropped.
5. A token longer than 3 characters and ending in `s` loses that trailing `s` (`orders` → `order`, `notes` → `note`). There is no other stemming.

### Why folding, and its limit

Rule 3 in its "everything is lowercased" form did not say which lowercasing algorithm to use, and the two implementations diverged silently: JS `toLowerCase` does full case mapping and expands `İ` into `i` + U+0307, while .NET `char.ToLowerInvariant` does simple mapping and produced `i`. A description containing `İSTANBUL` did not match the query `istanbul` in TS but did in C# — and both conformed to the old rule.

With NFD applied first, `İ` already decomposes into `I` + U+0307, the combining mark is dropped, and what remains is an `I` that both sides lowercase identically. Accents fall away in the same step (`sipariş` → `siparis`), which strengthens prefix matching in agglutinative languages.

Folding is **language-independent**; there is no Turkish-specific mapping table. Its deliberate limit: the dotless `ı` stays distinct from `i`, and `ß` does not expand to `ss` — because .NET's invariant uppercase table does not convert those two characters, extending the folding there would make the two SDKs diverge. The limit is pinned by the `dotless-i-stays-distinct.json` fixture.

## Matching: prefix

If a query token is **at least 3 characters**, it matches when it is a prefix of a document token; a document's `tf` is the summed frequency of every prefix-matching document token, and `df` is the number of documents carrying at least one prefix match. Shorter query tokens match exactly only (`id` does not match `identity`).

The rationale is agglutinative languages. In Turkish descriptions, `siparişi`, `siparişe` and `siparişler` are the same concept; stemming requires grammar, prefix matching does not. In English, `order` → `ordering`, `orders` is naturally covered too. The converse is not covered: if the query is longer than the document token (`siparişleri` vs `siparişi`) there is no match — keeping the query short is the agent's job, and the meta-tool description says so.

## Fields and weights

| Field         | Weight |
| ------------- | ------ |
| `name`        | 3.0    |
| `description` | 1.5    |
| `tags`        | 1.0    |
| `route`       | 1.0    |

A document's term frequency is the sum of the weights of every field the term occurs in (`tf`). Document length is the sum of all `tf` values; average length is taken over the documents.

## Scoring

BM25 with `k1 = 1.2`, `b = 0.75`:

```text
idf(t)     = ln(1 + (N − df(t) + 0.5) / (df(t) + 0.5))
norm(t, d) = tf · (k1 + 1) / (tf + k1 · (1 − b + b · len(d) / avgLen))
score(q,d) = Σ_{t ∈ q} idf(t) · norm(t, d)
```

`N` is the document count and `df(t)` is the number of documents containing the term. A document scoring zero does not appear in the result. Ordering: score descending, and on a tie name ordinal ascending. Returns up to `limit`.

There is no heavy dependency; the formula is ten lines in any language and is fixed so it can be matched exactly by fixtures. No synonyms, language models or embeddings are used — those are the agent's job, not the SDK's.

## Known limits

- Stemming is only the English plural `s`; other suffixes are handled by prefix matching, and there is no dictionary or language model. The description language is the backend's language; heavy stemming would introduce a language dependency into the SDK.
- `total` is the number of tools **the declarative layer** counted as visible; the T2 probe does not change it ([visibility.md](visibility.md), T2 "Budget"). Because the probe runs only on the first K candidates after ranking, a probe-aware `total` would depend on `limit` and would be misleading.
