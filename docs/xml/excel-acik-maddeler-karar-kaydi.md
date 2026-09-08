# Excel açık maddeleri — doğrulama ve kullanıcı kararları

Tarih: 2026-09-08. Durum: #17/#33/#35 hedef regresyonları çalıştırıldı; #26/#27/#28 için kabul edilen kararlar uygulandı. Uygulama commit’i `b4924d8`; kanıt kaydı `310064e`. Bu belge bu altı maddeyi kapsar; [35 bulgunun tamamı](excel-file-core-bulgular.md) ve [test/fixture/komut kaydı](excel-hardening-uygulama.md) ayrı tutulur.

Yerel ortam macOS arm64 / Node 24.12.0. 449 test, type-check, lint, format ve temiz paket/MCP doğrulaması geçti. Linux/Windows dahil tam platform matrisi henüz çalıştırılmadı. [GitHub Actions çalıştırma rehberi](excel-platform-testleri.md) hazır; XML geçiş kapısı kapalı.

## Başlangıç iddiası ve ölçüm

#17, #33 ve #35 başlangıçta üretim hatası olarak kanıtlanmış değildi; ilgili özel yolların test kapsamı doğrulanamamıştı. Test kaynaklarında bir hata kodunun bulunmaması, dolaylı kapsamın yokluğunu kanıtlamaz.

Vitest ile eşleşen `@vitest/coverage-v8@3.2.7` eklendi. Native/snapshot arayüzüne uyarlanan mevcut 392 test, yeni hedef testler eklenmeden çalıştırıldı: CSV byte/hücre hata dalları, NFC belirsizlik dalı ve 1904 yolu sıfır hit verdi. Bu ölçüm eski HEAD’in birebir çalışması değil, mevcut testlerin arayüz uyarlaması sonrası ölçümüdür. Hedef testler eklendikten sonra bu dallar çalıştırıldı.

## D17 — CSV byte ve hücre sınırları

**Durum: hedef kapsam açığı yerelde kapandı.** Gerçek 16 MiB ve 2.000.000 hücre limitleri küçültülmeden test edildi.

- `enforces the real 16 MiB byte boundary before decoding`: geçerli tam sınır kabul edilir; +1 byte `file_too_large` verir. Parser ve MCP handler denetlenir. Parser'daki Proxy kontrolü limit üstünde byte erişimi/decode başlamadığını sınar.
- `enforces exactly 2,000,000 fields independently of bytes and record width`: header dahil tam 2.000.000 alan kabul edilir; +1 alan doğru hata koduyla reddedilir. Fixture byte ve kayıt genişliği sınırlarının altında kalır.
- Format byte limiti native snapshot okumasına verilir; native katman okuma öncesinde boyutu denetler, büyüyen dosyayı da sınırlı okur. Eski `handle.readFile` akışı kaldırıldı.
- Kayıt materialize edilmeden önce 16.384 alan sınırı uygulanır; dört delimiter, escaped quote ve multiline girdiler ayrıca sınanır.

Kanıt: `packages/excel-mcp/test/hardening.spec.ts`; kaynak maliyeti için `resource-security.spec.ts` ve `fixtures/measure-hardening.mjs`. CSV byte hata dalı ve hücre hata dalı coverage’da hit aldı. Bu sonuç, başlangıçtaki kapsam açığını kapatır; başlangıçta zaten bulunan iki limitin üretimde bozuk olduğu iddiası yapılmaz.

## D33 — Unicode normalizasyonunda çakışan sayfa adları

**Durum: hedef kapsam açığı yerelde kapandı.**

`preserves exact case and detects both NFC-colliding names in a real file` testi gerçek XLSX içinde birleşik aksan ve harf + birleştirici aksanla yazılmış iki farklı sheet adını yükler. İki adın gerçekten korunduğu doğrulanır; resolver ve MCP handler belirsizlikte `ambiguous_sheet` verir. Sessizce ilk sheet seçilmez. `ambiguous_sheet` coverage dalı çalıştırıldı.

Kanıt: `packages/excel-mcp/test/hardening.spec.ts`. Tek sheet'in NFC eşdeğer yazımla seçilebildiği mevcut regresyon da korunur. Bu sonuç büyük/küçük harf kararından (#26) ayrıdır.

## D35 — 1904 tarih sistemi

**Durum: hedef kapsam açığı yerelde kapandı.**

`uses independent serial date oracles for 1900/1904 (#35)` testi aynı sabit takvim tarihini iki gerçek XLSX ile doğrular:

| Oracle                 | 1900 sistemi | 1904 sistemi |
| ---------------------- | ------------ | ------------ |
| Takvim tarihi          | 2024-01-01   | 2024-01-01   |
| Ham OOXML seri değeri  | 45292        | 43830        |
| Öğlen saat kesri       | 45292.5      | 43830.5      |
| Describe tarih sistemi | `1900`       | `1904`       |

Workbook bayrağı ve ham seri değerler doğrudan OOXML içinde denetlenir; beklenti yalnız aynı writer/reader çiftinden türetilmez. `read_sheet` handler’ı aynı takvim tarihi ve saat kısmını döndürür. 1904 metadata branch’i çalıştırıldı.

Kanıt: `packages/excel-mcp/test/hardening.spec.ts`.

## K26 — Sayfa adı seçimi

**Kullanıcı kararı: A kabul edildi ve uygulandı.** Kesin, büyük/küçük harfe duyarlı ve NFC eşdeğer eşleşme korunur. `Sales` için `sales` otomatik seçilmez; `unknown_sheet` ve gerçek sheet adları önerilir. Tool açıklaması semantiği belirtir.

Karar geçmişi: B seçeneği, kesin eşleşme yoksa harf duyarsız tek adayı seçmekti; kabul edilmedi. #33’teki birden fazla NFC eşleşmesi her zaman belirsizliktir.

Kanıt: D33’teki gerçek dosya testi exact case, öneriler ve NFC davranışını birlikte doğrular.

## K27 — Cursor ile çelişen okuma seçenekleri

**Kullanıcı kararı: A kabul edildi ve cursor v2 ile uygulandı.** Açıkça farklı seçenek reddedilir; hata seçenek adını ve cursor olmadan yeniden başlatma önerisini taşır. Varsayılanlar doldurulmadan önce çatışma kontrol edilir.

Karar geçmişi: B seçeneği farklı argümanı sessizce bastırıp etkili seçenekleri bildirmekti; kabul edilmedi. Eski v1 token'ları `invalid_cursor` ve yeniden başlatma önerisi alır.

| Seçenek             | Gönderilmedi      | Aynı açık değer | Farklı açık değer |
| ------------------- | ----------------- | --------------- | ----------------- |
| `valueMode`         | Cursor’dan devral | Kabul           | Reddet            |
| `mergedCells`       | Cursor’dan devral | Kabul           | Reddet            |
| `headerRow`         | Cursor’dan devral | Kabul           | Reddet            |
| `headerScan`        | Cursor’dan devral | Kabul           | Reddet            |
| `includeHyperlinks` | Cursor’dan devral | Kabul           | Reddet            |
| CSV `delimiter`     | Cursor’dan devral | Kabul           | Reddet            |
| CSV `encoding`      | Cursor’dan devral | Kabul           | Reddet            |

`maxCells` geçerli sınırlar içinde değişebilir. `cursor + sheetName/range` yasağı korunur. Bu değişiklikler [sürüm notlarında](../../packages/excel-mcp/CHANGELOG.md) açıklanır.

Kanıt: `hardening.spec.ts` cursor seçenek matrisi, CSV parse seçenekleri, eski/bozuk token testleri; mevcut `cursor.spec.ts` ve `read-sheet.spec.ts` regresyonları.

## K28 — Cache ve cursor için içerik güvencesi

**Kullanıcı kararı: B kabul edildi ve uygulandı.** Cache kullanımı ve cursor devamında dosya yeniden güvenli okunur. SHA-256, parser’ın kullandığı aynı sınırlı snapshot byte'larından hesaplanır; parse seçenekleri de kimliğe bağlanır. İçerik ve seçenekler eşleşirse parse sonucu yeniden kullanılabilir.

Karar geçmişi: A seçeneği metadata tabanlı hızlı kontrolü korumaktı; kabul edilmedi. Ek dosya okuma maliyeti kabul edildi. Yalnız ilk parse sırasında hash hesaplayıp devamda mtime/boyuta güvenmek uygulanmadı.

Kanıt: `revalidates bytes on a cache hit even after mtime and size are restored` testi ile ayrı cursor kontrolü, byte boyutu aynı tutulan ve mtime’ı geri yüklenen içerik değişimini sınar. Cache yeni içeriği görür; eski cursor geçersiz olur.

Dosya yetkilendirmesi başlangıçta açılan kök handle’ına bağlıdır. Okuma öncesi/sonrası kimlik ve metadata değişiminde `file_changed` döner. Eşzamanlı yazıya karşı atomik işletim sistemi snapshot’ı garantisi verilmez.

## Doğrulama sonucu ve kalan kapı

| Madde | Yerel durum                                                | Kalan              |
| ----- | ---------------------------------------------------------- | ------------------ |
| #17   | Gerçek byte/hücre sınırları, parser ve handler geçti       | Platform CI        |
| #33   | Gerçek iki sheet korunuyor; belirsizlik doğru reddediliyor | Platform CI        |
| #35   | Bağımsız seri/tarih/saat oracle’ları geçti                 | Platform CI        |
| #26   | Kabul edilen kesin/NFC sözleşmesi doğrulandı               | Platform CI        |
| #27   | Cursor v2 ve seçenek matrisi geçti                         | Platform CI        |
| #28   | Byte kimliği, cache ve cursor regresyonları geçti          | Native platform CI |

Tekrar üretme komutu: `pnpm turbo run test:coverage test check-types lint --filter=@sk-mcp/file-core-native --filter=@sk-mcp/file-core --filter=@sk-mcp/excel-mcp --continue=always`.

Son branch coverage: file-core %83,77 (160/191), Excel %86,16 (1220/1416). Yerel başarı bütün platformlarda başarı olarak sunulmaz. Linux/Windows CI run URL’si, commit SHA’sı ve hazır binary artifact’ları [kapanış kaydına](excel-hardening-uygulama.md) eklendiğinde platform kapısı yeniden değerlendirilir.
