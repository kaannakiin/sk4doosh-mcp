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
- **Çıktı yazan tool yalnızca `createMcpOutputServer` ile kaydedilir.** `ToolDefinitions` ve `createMcpSourceServer` salt-okunur kalır; `ownOutput`, `OwnOutputToolDefinition`, `ToolCatalog` ve `createMcpOutputServer` `file-core` ve `db-core` tarafından yeniden ihraç edilmez. Diske yazmanın kuralları (tek klasör, `wx`, adı sunucu seçer) tüketicinindir: [docs/cikti-yazan-tool-karari.md](../../../docs/cikti-yazan-tool-karari.md).
- **`zod` ve `@modelcontextprotocol/server` peer bağımlılıktır.** İki kopya `z.infer` tip kimliğini bozar ve SDK'nın şema introspection'ı `instanceof` kontrolü yapar.
- **`Fingerprint` markası yalnızca burada bildirilir.** İkinci bir `unique symbol` bildirimi aynı marka değildir.
