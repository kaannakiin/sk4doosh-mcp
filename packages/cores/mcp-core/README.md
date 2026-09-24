# @sk-mcp/mcp-core

Salt-okunur MCP sunucularının kaynak-agnostik makinesi. `@sk-mcp/file-core` (dosya kaynakları) ve `@sk-mcp/db-core` (SQL kaynakları) bunun üzerine kuruludur.

Bu paket **`@sk-mcp/core` değildir** ve ona iki yönde de bağlanmaz. `@sk-mcp/core` spec'in HTTP katalog referans implementasyonudur; bu paket yerel kaynak sunucularının ortak makinesidir.

Kaynağın ne olduğunu bilmez: dosya, veritabanı, başka bir şey. Bildiği tek şey bir tool'un girdi şemasından yanıt zarfına kadar olan yol.

## Ne veriyor

| Modül        | İçerik                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools`      | `readOnly`, `ownOutput`, `json`, `toToolError`, `guard`, `HandlersOf<D>`, `ToolCatalog` ve tool tip makinesi                                                                           |
| `server`     | `createMcpSourceServer` (salt-okunur), `createMcpOutputServer` (çıktı yazan tool'lu katalog), `serveMcpSourceStdio` — definitions üzerinden döngüyle kayıt, stdio ve sinyal bağlantısı |
| `payload`    | `measureJson`, `createPageBudget`, `clampJsonField` — yanıt bütçesi                                                                                                                    |
| `errors`     | `McpSourceError`, `SourceErrorCode`, `ErrorFactory`, `internal_error` politikası, enjekte redaksiyon                                                                                   |
| `cursor`     | `Fingerprint` markası, `Cursor<TPosition>`, base64url codec, `isFresh`                                                                                                                 |
| `limits`     | `mcpCoreLimits` — `maxPayloadBytes`, `maxStringChars`, `catalogTtlMs`                                                                                                                  |
| `unicode`    | `fold`, `canonical`, `asciiLower`, `asciiUpper`, `truncateWellFormed`, `truncateUtf8`                                                                                                  |
| `vocabulary` | `Vocabulary<TToolName>` — kullanıcı-yüzlü isimlerin enjeksiyonu                                                                                                                        |

## Bağlayıcı kurallar

- **Bu paket kaynak-özgü kelime taşımaz.** "file", "path", "workbook", "table", "query" gibi bir string literal burada bir kusurdur; isimler `Vocabulary` ile gelir.
- **Redaksiyon enjekte edilir, seçilmez.** `ErrorContext.redact` bir kaynağın asla ifşa etmemesi gerekeni siler — bir dosya kökü, bir bağlantı sırrı. Çekirdek neyin hassas olduğunu bilemez, o yüzden kararı vermez.
- **Hata örnekleri enjekte edilen `ErrorFactory` ile üretilir.** Paket iş yollarında asla `new McpSourceError(...)` çağırmaz; böylece tüketicinin kendi hata sınıfı ve `instanceof` kontrolleri korunur.
- **`guard()` `GuardedHandler`'ın tek üreticisidir** ve `HandlersOf<D>` başka hiçbir şeyi kabul etmez. Yanıt bütçesinin atlanamaz olmasını sağlayan şey budur: elle yazılmış bir handler kaydedilemez.
- **Çıktı yazan tool yalnızca `createMcpOutputServer` ile kaydedilir.** `ToolDefinitions` ve `createMcpSourceServer` salt-okunur kalır; `ownOutput`, `OwnOutputToolDefinition`, `ToolCatalog` ve `createMcpOutputServer` `file-core` ve `db-core` tarafından yeniden ihraç edilmez. Diske yazmanın kuralları (tek klasör, `wx`, adı sunucu seçer) tüketicinindir.
- **`zod` ve `@modelcontextprotocol/server` peer bağımlılıktır.** İki kopya `z.infer` tip kimliğini bozar ve SDK'nın şema introspection'ı `instanceof` kontrolü yapar.
- **`Fingerprint` markası yalnızca burada bildirilir.** İkinci bir `unique symbol` bildirimi aynı marka değildir.

## Design decisions

**Why a separate package.** `file-core` held this machinery before a SQL server needed it. Three options were weighed:

- _Copy it into `db-core`._ About 430 lines, so a fix to the response budget would have to land twice. That is a fork, not a shared primitive.
- _Depend on `file-core`._ `ErrorFactory` is contravariant in its code parameter, so `DbErrorCode` would have had to widen to carry `path_outside_root` and `file_too_large`; `Vocabulary` would have forced `rootLabel` and `readableLabel` on a SQL server; and a pure-JS database server would have shipped `file-core-native`'s C++ prebuilds.
- _Rename `file-core`._ The file layer (sandbox, listing, document cache, native access) is real and large; leaving it inside the core would still ship the prebuilds to every consumer.

**Why a dependency, not a peer.** `guard()` classifies with `instanceof McpSourceError` and every product error class extends it. Two resolved copies would break that check silently — the same trap as two zod majors. `zod` and the MCP SDK stay peers for the same reason in the other direction: the consumer owns them.

**Why `GuardContext.fail` is `ErrorFactory<"resource_limit">`.** `guard()` only ever fails with that code. Narrowing it keeps every existing caller compiling (contravariance) and never forces a consumer's error union to carry the core's codes.

**Why the own-output tool type looks the way it does.** A client may approve a tool by its annotations alone — Codex does with `default_tools_approval_mode = "auto"` — so a writing tool that claimed `readOnlyHint: true` would be an unapproved write. Rejected on the way:

- _Widening `ToolDefinitions`._ Every read-only server's `satisfies ToolDefinitions` would silently start accepting a writing tool.
- _Widening `createMcpSourceServer`._ `file-core` re-exports it as `createFileSourceServer`, so the writing type would leak into every file server.
- _A `unique symbol` brand on the annotations._ Annotations travel as JSON and the symbol key is dropped; a plain object would still match structurally.
- _Putting the writer here._ The core has no runtime dependencies and carries no source vocabulary; the writer lives with the consumer that makes the promise.

A tool that changes or deletes existing state fits no catalogue type, on purpose.
