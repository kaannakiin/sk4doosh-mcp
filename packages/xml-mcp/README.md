# @sk-mcp/xml-mcp

Yerel XML belgelerini okuyan, salt-okunur, sandbox'lanmış MCP sunucusu.
`@sk-mcp/file-core` üzerine kuruludur; `@sk-mcp/core`'a **bağımlı değildir** ve
`packages/xml-lab`'den hiçbir şey import etmez.

## Bu sürümde ne var

Dört tool: `list_documents`, `describe_document`, `read_node`, `find_in_document`.
XPath, kayıt projeksiyonu ve aggregate sonraki fazdadır.

`list_documents` **hiçbir dosyayı parse etmez**; listelenen yol bir adaydır, geçerli
XML garantisi değildir.

`read_node` derinlik-öncelikli sırada düz kayıtlar döndürür. Her kayıt `nodeId`,
`parentId` ve `childIndex` taşır, yani text/element/comment/PI sırası sayfa
sınırında korunur ve sayfalar tekrar veya kayıp olmadan birleşir. `nodeId` kök'ten
itibaren childIndex yoludur (`"1.3.2"`), belge çapında tekildir.

Değerler yazıldığı gibi döner: baştaki sıfır, ondalık yazımı ve büyük tamsayı
değişmez, whitespace trim edilmez, CDATA metinden ayrı bir `kind` taşır.

## Seçenekler

```ts
createXmlMcpServer(root, {
  documentCacheSize: 4, // aynı anda bellekte tutulan belge sayısı
  maxConcurrentListings: 4, // eşzamanlı list_documents çağrısı
});
```

`documentCacheSize` (S) tek knob'dur; worker kapasitesi `W = 2S` ile türetilir ve
`W ≥ 2S−1` invaryantı testle sabitlenir. **Bu bir bütçedir, yaptırım değildir**:
`worker.resourceLimits` JS heap'ini bağlar, WASM linear memory'yi değil, yani
bütçeyi aşmak temiz bir `resource_limit` değil süreç ölümüdür. Ölçülen maliyet
kaynak byte'ı başına 9,25–10,08×, yani 8 MiB tavanda kalıcı belge başına ≈ 81 MiB;
varsayılan S=4 en küçük desteklenen hostta güvenlidir.

## Bağlayıcı kurallar

- **Parse worker'da olur.** Ana süreç yalnız serileştirilebilir handle taşır; WASM pointer'ı sınırı geçmez. `packages/file-core`'un doküman store'una disposal hook'u eklenmedi ve gerekmedi.
- **Worker girişi host yüzeyini import etmez.** `src/xml-worker.ts` yalnız `node:worker_threads`, `node:buffer`, `libxml2-wasm` ve type-only protokolü görür; bir lint sınırı bunu zorlar. Worker bir kod string'i döner, hata nesnesini ana taraf kurar.
- **DOCTYPE parse'tan önce reddedilir.** Prolog tarayıcısı ana süreçte çalışır; `doc.dtd` yalnız ikinci denetimdir. Ölçüldü: `XML_PARSE_NO_XXE` internal DTD subset'ini engellemiyor.
- **Worker'ın stdout'u ebeveynin fd 1'ine karışmaz.** `stdout: true` ile ayrılır; stdio MCP'de tek bir kaçak satır JSON-RPC'yi bozar.
- **`diag` production'da kapalıdır** ve env var ile açılamaz: %24,9 maliyetli ve ham raporu motor pointer'ı taşır.
- **Desteklenmeyen encoding parse'tan önce reddedilir.** Prolog tarayıcısı XML 1.0 Appendix F dört-byte autodetection'ı uygular; UCS-4 ve EBCDIC aileleri `unsupported_encoding` alır. Ölçüldü: eski tarayıcı bu ailelerde DOCTYPE'ı kaçırıyordu.
- **`libxml2-wasm` exact `0.7.2`.** Caret F0-01 bütünlük kaydını sessizce geçersiz kılar; CI tarball denetleyicisi bunu zorlar.

## Çalıştırma

```text
sk-mcp-xml <xml-source-root>
```

Kök zorunlu bir konumsal argümandır; env var yoktur. Okunabilir uzantılar:
`.xml`, `.xsd`, `.xhtml`, `.svg`, `.csproj`, `.props`, `.targets`, `.config`, `.resx`.
`.config` gibi uzantılar XML garantisi değildir; parse hatası normaldir.

## Limitler

DOM'a alınan dosya 8 MiB, iş başına 2 saniye, tek etkin worker, kuyruk 5,
yanıt zarfı 512 KiB, sayfa varsayılan 50 / en fazla 200 düğüm veya eşleşme, DOM
derinliği 128.

Prolog'daki comment ve processing instruction'lar bu sürümde adreslenemez; sıralı
görünüm belge elementinde köklenir.
