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

`packages/xml-mcp` `libxml2-wasm` kullanıyor çünkü şeması **bilinmeyen** belge üstünde DOM ve XPath
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

## Komutlar

```text
pnpm turbo run build check-types lint --filter=@sk-mcp/ooxml-core
pnpm turbo run test --filter=@sk-mcp/ooxml-core
```
