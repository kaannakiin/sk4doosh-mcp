# @sk-mcp/file-core

Dosya okuyan, salt-okunur, sandbox'lanmış MCP sunucularının paylaşılan makinesi. `@sk-mcp/excel-mcp`, `@sk-mcp/xml-mcp` ve `@sk-mcp/pdf-mcp` bunun üzerine kuruludur.

Kaynak-agnostik makine (`guard`, yanıt bütçesi, hata zarfı, cursor codec, stdio sunucusu) **`@sk-mcp/mcp-core`'a taşındı**; bu paket onu tüketir, dosyaya özgü katmanı ekler ve tam yüzeyi yeniden ihraç eder.

Bu paket **`@sk-mcp/core` değildir** ve ona iki yönde de bağlanmaz. `@sk-mcp/core` spec'in HTTP katalog referans implementasyonudur; bu paket yerel dosya kaynaklarının makinesidir.

## Ne veriyor

| Modül        | İçerik                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths`      | `SandboxedPath` markası, `SandboxRoot`, `isContained`, `createSandboxRoot`, `resolveSourcePath` — sıralı fail-fast zinciri ve varlık ifşa etmeme özelliği |
| `listing`    | `listSources` — glob, symlink containment, tarama sınırı, okunamayan girdi sayımı                                                                         |
| `documents`  | `createDocumentStore` — aç + fstat + boyut kapısı + parmak izi + örnek-kapsamlı LRU; parse ve `variantKey` kancaları                                      |
| `cursor`     | `fingerprint` — yol, mtime ve boyuttan kimlik; içerik damgası `mcp-core`'dan gelir                                                                        |
| `errors`     | `FileSourceError`, `CoreErrorCode`, `redactRoot` — `mcp-core`'un tabanını dosya kodlarıyla genişletir                                                     |
| `formats`    | `FormatRegistry` — uzantı → format eşlemesi, `unsupported_extension`                                                                                      |
| `tools`      | `guard` ve `toToolError` sarmalayıcıları — `mcp-core`'a kök redaktörünü bağlar                                                                            |
| `cli`        | `parseServerArgv` — saf argv ayrıştırması                                                                                                                 |
| `vocabulary` | `Vocabulary<TToolName>` — `mcp-core`'un tabanına `rootLabel`, `readableLabel`, `tooLargeRecovery` ekler                                                   |

## Bağlayıcı kurallar

- **Bu paket format-özgü kelime taşımaz.** "workbook", "sheet", "spreadsheet", "excel" gibi bir string literal burada bir kusurdur; isimler `Vocabulary` ile gelir.
- **Hata örnekleri enjekte edilen `ErrorFactory` ile üretilir.** Paket asla `new FileSourceError(...)` çağırmaz; böylece tüketicinin kendi hata sınıfı ve `instanceof` kontrolleri korunur.
- **`zod` ve `@modelcontextprotocol/sdk` peer bağımlılıktır.** İki kopya `z.infer` tip kimliğini bozar ve SDK'nın şema introspection'ı `instanceof` kontrolü yapar.
- **Kök redaksiyonu `guard` tarafından bağlanır**, çağrı yerlerinde değil. `mcp-core`'un `ErrorContext.redact` dikişine `redactRoot` burada takılır; hiçbir dosya sunucusu mutlak yol taşıyan bir hata zarfı üretemez.
- **`SandboxedPath` markası yalnızca burada bildirilir**, `Fingerprint` ise `mcp-core`'da. İkinci bir `unique symbol` bildirimi aynı marka değildir.
