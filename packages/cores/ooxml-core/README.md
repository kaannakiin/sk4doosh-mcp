# @sk-mcp/ooxml-core

OOXML (ECMA-376) konteynerlerini okuyan paylaşılan çekirdek: zip part kaynağı, OPC paketi,
ilişkiler, içerik türleri ve tek geçişli XML part taraması. `@sk-mcp/excel-mcp` tüketicisidir;
`docx-mcp` ve `pptx-mcp` aynı çekirdeğe oturur.

## Sınır

Bu paket **format kelime hazinesi taşımaz**. `xl/`, `word/`, `ppt/` önekleri, SpreadsheetML /
WordprocessingML / PresentationML namespace'leri ve "workbook", "sheet", "document", "presentation"
adları buraya girmez. Konteyner adları — package, part, relationship, archive — ECMA-376 kelime
hazinesidir ve serbesttir.

Hiçbir `@sk-mcp/*` paketini adlandırmaz. Hata üreteci yapısal olarak enjekte edilir:

```ts
const reader = createOoxmlReader({
  fail: (code, message) =>
    new SkMcpExcelError(excelCodeFor(code), message, recoveryFor(code)),
});
```

Çekirdek yalnızca kendi bildiği olguyu verir (hangi part, hangi zip özelliği, parser ne dedi);
hata sınıfını, kod kelime hazinesini ve recovery metnini tüketici seçer — format nouns oraya aittir.

## Neden SAX, neden DOM değil

`packages/servers/xml-mcp` `libxml2-wasm` kullanıyor çünkü şeması **bilinmeyen** belge üstünde DOM ve XPath
gerekiyor; o seçim worker izolasyonunu, pool'u ve makine-denetimli worker modül grafiğini getirdi.
OOXML part'larında şema **bilinir** ve her okuma ileri yönlü tek geçiştir. Rastgele erişim part'lar
_arasındadır_, ki onu `PartSource` indeksi karşılar. Bu yüzden burada worker yok, pool yok, WASM yok.

## Zip

`fflate` üstünde iki geçiş: sayım geçişi hiçbir şeyi inflate etmeden dizini indeksler ve red
listesini uygular, okuma yalnız istenen part'ı açar. Boyut kapıları sayım geçişinde koşar — inflate
sonrası uygulanan kapı kapı değildir.

Üç kapı birlikte çalışır, çünkü tek eşik ya gerçek dosyayı reddeder ya bombayı geçirir:

| Kapı                     | Değer   | Dayanak                                                                        |
| ------------------------ | ------- | ------------------------------------------------------------------------------ |
| `maxPartBytes`           | 384 MiB | Node `MAX_STRING_LENGTH` 512 Mi karakter; `part()` decode edilmiş string döner |
| `maxExpansionRatio`      | 200:1   | Ölçülen gerçek en yüksek oran 40:1; tek deflate akışı ~1032:1'i aşamaz         |
| `ratioFloorBytes`        | 16 MiB  | Altında oran denetlenmez; küçük tekrarlı part normaldir                        |
| `maxDecodedPackageBytes` | 512 MiB | Çok sayıda sınır-altı part'ın toplamını bağlar                                 |

## Bilinen sınır

Zip entry başına şifreleme (PKWARE) **tespit edilmez**: `fflate` general purpose flag'i filtreye
göstermiyor. Office'in şifrelediği belge zaten zip değil CFB konteyneridir ve
`classifyContainerMagic` tarafından paketin dışında yakalanır. Şifreli bir entry bozuk part olarak
başarısız olur.

## Rejected alternatives

- **An in-house zip reader.** About 330 lines and a 30-case test matrix as a precondition. `fflate` is mature, MIT, dependency-free, and its `filter` callback still leaves the bomb gate to this package.
- **A `file-core` dependency for `asciiLower`.** A twelve-line function would pull in the MCP SDK and zod peers and invert the layering; it is copied instead (`src/primitives/text.ts`).
- **An in-process BIFF8 or Word binary reader.** Thousands of lines of parser for an effectively undocumented format, over untrusted input, inside a read-only server whose value is a small attack surface.
- **Shelling out to `soffice --convert-to`.** It writes the converted file, depends on an install no manifest can express and no CI runner has, costs seconds per document, and hands untrusted input to a large C++ surface with a macro and URL-fetch CVE history.
- **A `PartPath` brand.** A forged part path is a cache miss (`part()` returns `undefined`), not a traversal; nothing is opened on disk, so the brand buys nothing. The `Relationship` union already prevents mix-ups.
- **An `"encrypted"` `ContainerKind`.** It would separate encrypted OOXML from legacy binaries, but the combined message is never wrong today, and a new member breaks every exhaustive switch.

## Komutlar

```text
pnpm turbo run build check-types lint --filter=@sk-mcp/ooxml-core
pnpm turbo run test --filter=@sk-mcp/ooxml-core
```
