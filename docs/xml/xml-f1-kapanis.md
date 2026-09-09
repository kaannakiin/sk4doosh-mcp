# XML F1 kapanış kaydı

Durum: **uygulama tamamlandı, platform CI bekleniyor** (2026-09-09). F1-03, F1-05 ve F1-06'nın
kodu, testi ve paket doğrulaması yerelde geçti; `tamamlandı` durumu [README](README.md)'nin
yönetim kuralı gereği ancak beş hedef × Node 22/24 CI koşusunun run kimliğiyle yazılır.
Bu belge o koşudan önceki bütün ölçümleri tutar ve run kimliği geldiğinde başlığı güncellenir.

F1'i kapatan iş **F2-01/02/03 görev kimlikleriyle** yürütüldü; kimlikler değişmedi.
Görev kimliklerinin sabitliği [README](README.md)'nin yönetim kuralıdır.

## Kabul edilen kapsam

`packages/xml-mcp` bu teslimde yalnız F1'in kapılarını kanıtlayacak kadarını içerir:
paket yüzeyi, `file-core` adaptörü, tek parse policy'si, worker yürütücüsü, XML format
registry'si ve `list_documents`. Genişletilmiş ad/adres modeli, `describe_document`,
`read_node` ve `find_in_document` F2-04–09'da kalır.

`list_documents`'ın hiç parse etmemesi kasıtlıdır: sandbox, listeleme ve yanıt bütçesi
yolunu sıfır XML semantiğiyle egzersiz eder.

## Başlangıç durumu

| Ölçüm                        | Önce | Sonra   |
| ---------------------------- | ---- | ------- |
| Paket sayısı (dosya kaynağı) | 3    | 4       |
| Test toplamı                 | 450  | **529** |
| `file-core`                  | 97   | 133     |
| `excel-mcp`                  | 351  | 354     |
| `xml-mcp`                    | yok  | 40      |
| `file-core-native`           | 2    | 2       |

Sürümler: `@sk-mcp/file-core` `0.1.0 → 0.2.0`, `@sk-mcp/excel-mcp` `0.3.0 → 0.4.0`,
`@sk-mcp/xml-mcp` `0.1.0` (yeni). `1.0` yükseltmesi yapılmadı; [karar 016](../kararlar/016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md).

## Görev bazında kapanış

### F1-05 — ortak yanıt bütçesi

| Alan          | Değer                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Görev kimliği | F1-05                                                                       |
| Durum         | uygulandı; platform CI bekleniyor                                           |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/file-core --filter=@sk-mcp/excel-mcp` |
| Ortam         | darwin arm64, Node v24.12.0                                                 |
| Beklenen      | Başarı, hata ve recovery dahil hiçbir yanıt 512 KiB'ı aşmaz                 |
| Gerçek        | Aşmıyor; kapı `guard`'da zorunlu yol                                        |

**Bu bir kâğıt kapısı değildi, canlı bir hataydı.** Değişiklikten önce `read_sheet`,
depoda duran `long-strings.xlsx` fixture'ında **524.561 byte** yanıt üretiyordu; sınır
524.288. Yani gönderilen kod 273 byte'lık bir aşımı sessizce yayınlıyordu ve hiçbir test
bunu göremiyordu, çünkü tek ölçüt `truncationReason` idi.

İki kök neden ölçüldü:

1. `read-sheet.ts` `JSON.stringify(line).length` sayıyordu — UTF-16 kod birimi, byte değil.
   Türkçe metinde sapma %32 (`"İstanbul Şişli Öğrenci Ağırlığı"` = 31 birim, **41 byte**).
2. Zarf hiç sayılmıyordu. Yalnız `nextCursor` 342 byte.

| Ölçüm                              | Önce                        | Sonra                         |
| ---------------------------------- | --------------------------- | ----------------------------- |
| `read_sheet` / `long-strings.xlsx` | **524.561 byte (273 aşım)** | **523.593 byte (695 pay)**    |
| Dönen satır                        | 649                         | 647                           |
| `truncationReason`                 | `maxPayloadBytes`           | `maxPayloadBytes` (değişmedi) |

Çekirdeğe giren yüzey: `measureJson`, `createPageBudget`, `clampJsonField`
(`packages/file-core/src/payload.ts`) ve `truncateUtf8` (`unicode.ts`).
`truncateWellFormed` **aynen korundu**: `maxStringChars` bir karakter sözleşmesidir,
byte sözleşmesi değil; ikisini birleştirmek tam olarak yukarıdaki hatanın kaynağıdır.

Rezerv aritmetiği `R + Σöğe + (n−1)` bir **tam eşitlik** olarak doğrulandı, tahmin değil;
packer bu yüzden O(n)'dir ve biriken sayfayı hiç yeniden serileştirmez.

Kapı `json()`'da değil **`guard`'da** duruyor. Gerekçe ölçülmüş: `json()` throw etseydi
`guard`'ın `catch`'i onu yakalar ve tüketicinin `normalize`'ı çıplak bir `FileSourceError`'ı
`SkMcpExcelError` olmadığı için sessizce `internal_error`'a düşürürdü. Kapı try/catch'in
dışında olmak zorunda.

Hata zarfının yapısal tabanı `{"error":"internal_error","message":""}` = **39 byte**.
512 KiB'a karşı ulaşılamaz; ulaşıldığında taban bütçeyi yener, kod korunur ve
`toToolError` asla recursion yapmaz, asla throw etmez.

**Yan bulgu, aynı değişiklikte düzeltildi:** `read-sheet.ts` `cellNotes`, `numberFormats`
ve `uncachedFormulas`'ı payload kontrolünden **önce** yazıyordu. Byte nedeniyle reddedilen
satırın note'ları, dönen `range` dışındaki adreslerle yanıtta kalıyordu. Commit artık
`admit` başarılı olduktan sonra yapılıyor.

### F1-03 — XML kaynak sahipliği

| Alan          | Değer                                                               |
| ------------- | ------------------------------------------------------------------- |
| Görev kimliği | F1-03                                                               |
| Durum         | uygulandı; platform CI bekleniyor                                   |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                      |
| Oracle        | worker içi `diag` projeksiyonu (tier-1); RSS kanıt ağırlığı taşımaz |
| Beklenen      | Altı yaşam döngüsü olayında da kullanılmayan DOM tutulmuyor         |
| Gerçek        | Tutulmuyor                                                          |

**`file-core`'a disposal hook'u eklenmedi ve gerekmedi.** `packages/file-core/src/documents.ts`
bu değişiklikte **hiç değişmedi**; K6'nın cevabının kelimesi kelimesine doğru kalması buna bağlı.
Store yalnız serileştirilebilir handle tutuyor ve bu mekanik olarak sınanıyor:
`JSON.parse(JSON.stringify(loaded))` yüklenen nesneye deep-equal olmalı. Pointer, düğüm,
fonksiyon veya `Buffer` bu testi geçemez.

| K6 olayı                | Nasıl sürüldü             | Gözlem                                           |
| ----------------------- | ------------------------- | ------------------------------------------------ |
| Normal bitiş            | parse → `release`         | `live` 0, `collected` 0                          |
| Hata                    | 20 malformed parse        | `live` 0, `cached` 0                             |
| Hata (DOCTYPE)          | reddedilen belge          | `live` 0 — adopt disiplini çalışıyor             |
| LRU tahliyesi           | kapasitenin üstünde belge | `live == cached`, kapasiteyi aşmıyor             |
| Seçenek/içerik değişimi | aynı yol, yeni içerik     | eski belge **ekleme anında** dispose; `cached` 1 |
| Worker ölümü            | `close()`                 | generation artıyor, store temizleniyor           |
| Shutdown                | `release` → diag          | `live` 0, `cached` 0, `collected` 0              |

`diag` **production'da kapalı** ve env var ile açılamaz: ölçülen maliyeti %24,9 ve
`diag.report()` ham çıktısı motor pointer'ı (`_ptr`) taşıyor. `worker-protocol.ts`
raporu okuyan tek yerdir ve `{ live, collected, cached }` projeksiyonu döner;
bir regresyon testi ham raporun `_ptr` ve sorgu metnini sızdırmadığını sabitler.

### F1-06 — iki tüketicili regresyon

| Alan          | Değer                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Görev kimliği | F1-06                                                                                                                                  |
| Durum         | uygulandı; platform CI bekleniyor                                                                                                      |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/file-core-native --filter=@sk-mcp/file-core --filter=@sk-mcp/excel-mcp --filter=@sk-mcp/xml-mcp` |
| Gerçek        | 529 test, dört paket, hepsi geçti                                                                                                      |

F6'nın "henüz çalıştırılmadı" diye kaydettiği dört filtreli kabul komutu **ilk kez koştu**.

`packages/xml-mcp/test/connection.spec.ts` [karar 015](../kararlar/015-dosya-kaynagi-cekirdegi.md)'in
öngördüğü şekli izliyor: 342 satırlık güvenlik suite'inin kopyası değil, kendi kelime
tablosu ve registry'si için bağlantı testleri — registry dokuz uzantıyı çözüyor ve
onuncuyu reddediyor, mesajlar `XML source root` diyor, recovery `list_documents`'a
yönlendiriyor, fırlatılan hata `SkMcpXmlError`, uzantılı dizin ve kök dışı symlink
reddediliyor, ve gerçek MCP istemcisiyle tool kaydı doğrulanıyor.

`file-core`'a XML kavramı girmedi ve `file-core → core` bağımlılığı eklenmedi.

## Paket doğrulaması

`pnpm pack` dört tarball üretti; `check-npm-tarballs.py` dördünü de geçirdi.
İki yeni kural eklendi: `@sk-mcp/xml-mcp` için `dist/xml-worker.js` varlığı
(Excel'in `dist/regex-worker.js` kuralını aynalar) ve `libxml2-wasm`'ın **exact**
sabitlendiği (`0.7.2`, caret yok — caret F0-01 bütünlük kaydını sessizce geçersiz kılar).

`smoke-file-packages.mjs` temiz bir tüketici projesine kurup gerçek stdio üzerinden
`list_documents` çağırıyor **ve** paketlenmiş worker'ı programatik olarak sürüp bir
belge parse ettiriyor. İkincisi F0-02'nin bıraktığı boşluğu kapatır: F0-02 WASM
çözümlemesini yalnız **ana thread'de** kanıtlamıştı. Assertion'ın gerçekten koştuğu
negatif kontrolle doğrulandı.

## Ölçülen ve kararı değişen noktalar

| Bulgu                                                                                                                                     | Sonuç                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XML_PARSE_NO_XXE` **internal DTD subset'i engellemiyor** — `<!DOCTYPE r [<!ENTITY x "y">]><r>&x;</r>` parse ediliyor ve `&x;` genişliyor | DOCTYPE kapısı prolog tarayıcısıdır ve **ana süreçte, parse'tan önce** çalışır. `doc.dtd` yalnız denetim katmanıdır; okunabildiğinde entity zaten genişlemiştir |
| Varsayılan `new Worker()` ile worker'ın stdout'u ebeveynin fd 1'ine ulaşıyor                                                              | `stdout: true, stderr: true` + `resume()`/pipe zorunlu. Gerçek CLI'a karşı stdio testi bunu sabitliyor                                                          |
| `diag` %24,9 maliyetli ve ham raporu pointer taşıyor                                                                                      | Production'da kapalı, env var yok, yalnız projeksiyon                                                                                                           |
| Worker `path` ile anahtarlanırsa aynı boyut + restore mtime değişimi sessizce eski içeriği döner                                          | Worker map anahtarı **`stamp`**; `contentFingerprint` zaten parse edilen byte'lar üzerinden sha256                                                              |
| base64 taşıma 8 MiB'da 6,06 ms ve 11 MiB ara string                                                                                       | Düz structured-clone kopya (1,89 ms)                                                                                                                            |
| Kuyruktaki istek byte tutarsa `B_q × B_f` = 40 MiB pinlenir                                                                               | Kapı **okumadan önce** alınır; pinlenen bellek 16 MiB'a iner. Yayınlanan kuyruk değeri 5 değişmedi (bağlayan kısıt istemci sabri)                               |

## Kalan sınırlar

1. **Sayfa ve toplam payload bütçesi ölçülmedi.** Dört tool birlikte çalışmadan ölçülemez; **F2-08**'e aittir. Bu teslim yalnız zarf kapısını kurar.
2. **`unsupported_encoding` yayınlanan hata birleşimine alınmadı.** libxml2 encoding ve well-formedness hatalarını aynı `XmlParseError` ile bildiriyor; ayırmak motor-mesajı eşlemesi ister (**F2-02**). Üretilemeyen bir kodu ilan etmek atlamaktan kötüdür.
3. **N eşzamanlı DOM'un bellek tavanı ölçülmedi.** F0-08 tek belge ölçtü; worker kapasitesi 8 bir yerleşim teoreminden geliyor, ölçümden değil. Ayrı bir ölçüm görevi gerekiyor.
4. **Prolog tarayıcısı UTF-32 ve EBCDIC prologlarında sınanmadı.** Fixture yok; `doc.dtd` backstop olarak kalıyor ve maliyeti yukarıdaki M11 satırıdır.
5. **Eşzamanlı listeleme sayısı sınırsız.** Bugün de öyle; F1-03'ün işi değil.
6. **`text-encoding` çıkarılmadı.** Ölçülen örtüşme yalnız BOM tablosuydu; gerekçe [karar 016](../kararlar/016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md).
7. **`file-core` 1.0 kararı verilmedi.** [Karar 015](../kararlar/015-dosya-kaynagi-cekirdegi.md) yalnız `0.x` kilidini kaldırır; karar **F6-08**'dedir.
8. **Platform CI koşmadı.** Yerel ortam tek host; beş hedef × Node 22/24 kanıtı alınmadan hiçbir durum satırı `tamamlandı` yazılmaz.

## Sonraki faza devir

| Nerede                            | Ne                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [F2](fazlar/02-okuma-mvp.md)      | F2-04 genişletilmiş ad/adres/sıralı düğüm modeli, F2-05/06/07 kalan üç tool, **F2-08 sayfa ve zarf bütçesinin ölçümü**, F2-09 agent walkthrough |
| [F6](fazlar/06-yayin-ve-kabul.md) | `file-core` 1.0 kararı, temiz tüketici kurulumu, yayın sırası                                                                                   |
