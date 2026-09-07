# @sk-mcp/file-core

Dosya okuyan, salt-okunur, sandbox'lanmış MCP sunucularının paylaşılan makinesi. `@sk-mcp/excel-mcp` bunun üzerine kuruludur; `xml-mcp` ve `pdf-mcp` de kurulacaktır.

Bu paket **`@sk-mcp/core` değildir** ve ona iki yönde de bağlanmaz. `@sk-mcp/core` spec'in HTTP katalog referans implementasyonudur; bu paket yerel dosya kaynaklarının makinesidir. Ayrım [paket-yerlesimi.md](../../docs/paket-yerlesimi.md)'de, gerekçe [karar 015](../../docs/kararlar/015-dosya-kaynagi-cekirdegi.md)'te.

## Ne veriyor

| Modül        | İçerik                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths`      | `SandboxedPath` markası, `SandboxRoot`, `isContained`, `createSandboxRoot`, `resolveSourcePath` — sıralı fail-fast zinciri ve varlık ifşa etmeme özelliği |
| `listing`    | `listSources` — glob, symlink containment, tarama sınırı, okunamayan girdi sayımı                                                                         |
| `documents`  | `createDocumentStore` — aç + fstat + boyut kapısı + parmak izi + örnek-kapsamlı LRU; parse ve `variantKey` kancaları                                      |
| `cursor`     | `Fingerprint` markası, `Cursor<TPosition>`, base64url codec, `isFresh`                                                                                    |
| `errors`     | `FileSourceError`, `CoreErrorCode`, `ErrorFactory`, kök redaksiyonu, `internal_error` politikası                                                          |
| `formats`    | `FormatRegistry` — uzantı → format eşlemesi, `unsupported_extension`                                                                                      |
| `tools`      | `readOnly`, `json`, `toToolError`, `guard`, `HandlersOf<D>` ve tool tip makinesi                                                                          |
| `server`     | `createFileSourceServer` — definitions üzerinden döngüyle kayıt                                                                                           |
| `cli`        | `parseServerArgv` — saf argv ayrıştırması                                                                                                                 |
| `unicode`    | `fold`, `canonical`, `asciiLower`, `asciiUpper`, `truncateWellFormed`                                                                                     |
| `vocabulary` | `Vocabulary<TToolName>` — kullanıcı-yüzlü isimlerin enjeksiyonu                                                                                           |

## Bağlayıcı kurallar

- **Bu paket format-özgü kelime taşımaz.** "workbook", "sheet", "spreadsheet", "excel" gibi bir string literal burada bir kusurdur; isimler `Vocabulary` ile gelir.
- **Hata örnekleri enjekte edilen `ErrorFactory` ile üretilir.** Paket asla `new FileSourceError(...)` çağırmaz; böylece tüketicinin kendi hata sınıfı ve `instanceof` kontrolleri korunur.
- **`zod` ve `@modelcontextprotocol/sdk` peer bağımlılıktır.** İki kopya `z.infer` tip kimliğini bozar ve SDK'nın şema introspection'ı `instanceof` kontrolü yapar.
- **Markalar (`SandboxedPath`, `Fingerprint`) yalnızca burada bildirilir.** İkinci bir `unique symbol` bildirimi aynı marka değildir.
- Sürüm ikinci bir format sunucusu paketi tüketene kadar `0.x`'te kalır.
