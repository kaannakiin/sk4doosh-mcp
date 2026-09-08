# Excel ve file-core güvenlik kapatma kaydı

Durum: uygulama ve macOS arm64 / Node 24 yerel doğrulaması tamamlandı. Linux/Windows ve diğer Node/mimari kombinasyonları CI çalışması bekliyor. XML geçiş kapısı bu kanıtlar gelene kadar kapalı; XML geliştirmesi başlamadı.

## Kabul edilen kapsam

35 bulgu; köke bağlı native dosya erişimi, içerik snapshot'ı, bütçeli listeleme ve regex, CSV/sorgu/header/cursor düzeltmeleri, metadata sınırlılıkları ve regresyonlar.
Linux glibc x64/arm64, macOS x64/arm64 ve Windows x64; Node 22/24. Güvensiz dosya açma fallback'i yok.
Kesin/NFC sayfa seçimi korunur. Cursor çatışmaları reddedilir. Min/max karma türleri reddeder. CSV boş satırları korunur.

## Başlangıç kanıtı

- `pnpm turbo run test check-types lint --filter=@sk-mcp/file-core --filter=@sk-mcp/excel-mcp --force`: 392 test başarılı; type-check başarılı; kullanılmayan `SheetSource` import'u için bir lint uyarısı.
- Native/snapshot sözleşmesine uyarlanan mevcut 392 test, yeni hedef testler eklenmeden coverage ile geçti. `test:coverage` sonucu: file-core branch %81; Excel branch %82,05. CSV byte/hücre hata dalları, NFC ambiguous_sheet dalı ve 1904 seçimi sıfır hit. Bu ölçüm başlangıç HEAD'inin değil, mevcut testlerin uyarlama sonrası çalışmasıdır.
- Başlangıç çalışma ağacında yalnız kullanıcıya ait `docs/xml/` dosyaları untracked.

## İş paketleri

| Paket                                | Bulgular                                  | Durum                                                  |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------------ |
| A — Dosya erişimi/snapshot/listeleme | 3, 7, 19, 28, 29, 30, 34                  | Yerel doğrulama geçti; platform matrisi bekliyor       |
| B — CSV                              | 1, 14, 15, 17                             | Uygulandı, regresyonlar geçti                          |
| C — Regex ve hesaplama               | 2, 4, 5, 6, 22, 23                        | Uygulandı, watchdog testleri geçti                     |
| D — Header/hücre/cursor              | 8, 12, 13, 16, 20, 21, 27                 | Uygulandı, regresyonlar geçti                          |
| E — Metadata ve regresyon            | 9, 10, 11, 18, 24, 25, 26, 31, 32, 33, 35 | Regresyonlar geçti; #9/#10/#25 açık destek sınırlılığı |

## Tekrar üretme ve kanıt

- **T**: `pnpm turbo run test:coverage test check-types lint --filter=@sk-mcp/file-core-native --filter=@sk-mcp/file-core --filter=@sk-mcp/excel-mcp --continue=always`. Native build bağımlılığı ve Excel worker build'i dahildir. Yerel sonuç: 97 file-core + 350 Excel + 2 native = **449 test**, type-check ve lint başarılı. Kullanılmayan import uyarısı kaldırıldı.
- **P**: Üç paketi `pnpm --filter <paket> pack --pack-destination ../../local/hardening-tarballs` ile paketle; `python3 .github/scripts/check-npm-tarballs.py local/hardening-tarballs`; `node .github/scripts/smoke-file-packages.mjs local/hardening-tarballs`. Temiz kurulum, gerçek stdio MCP `read_sheet` ve regex çağrısı yerel macOS paketleriyle geçti. Native binary ve worker tarball içinde doğrulanır.
- **F**: Değişen kaynak/config/dokümanlarda `pnpm exec prettier --check <dosyalar>`; `git diff --check`.
- **CI**: `.github/workflows/ci.yml` beş native hedef × Node 22/24 için build/test/temiz kurulum/MCP smoke tanımlar. Node 24 çıktıları birleştirilir; yayın tarball kontrolü beş binary'yi de zorunlu tutar. Bu matris yerelde çalıştırılmadı; CI sonuçları ve beş platform binary'si henüz teslim edilmiş sayılmaz.
- Coverage sağlayıcısı Vitest ile aynı sürümde: 3.2.7. Yerel son ölçüm: file-core branch %83,77 (160/191); Excel branch %86,16 (1220/1416). #17 byte/hücre, #33 `ambiguous_sheet`, #35 1904 dalları hedef testlerle çalıştırıldı. Coverage raporları paketlerin `coverage/` dizininde üretilir.
- Commit kanıtı: `b4924d8` (`fix(excel): harden file access, queries and metadata contracts`), dal `codex/excel-file-core-hardening`. Aşağıdaki 35 satırın kaynak/test uygulaması bu commit'tedir. Worker heap bütçesi 24 MiB old + 8 MiB young olarak ayarlandıktan sonra Excel'in 350 testi, type-check ve lint yeniden geçti. Çalıştırılmamış kontroller başarılı sayılmaz.

Test kısaltmaları: **EH** = `packages/excel-mcp/test/hardening.spec.ts`, **FH** = `packages/file-core/test/hardening.spec.ts`, **NS** = `packages/file-core-native/test/security.test.mjs` + `watchdog.mjs`, **RW** = `packages/excel-mcp/test/regex-security.spec.ts` + `fixtures/regex-watchdog.mjs`, **RS** = `packages/excel-mcp/test/resource-security.spec.ts` + `fixtures/measure-hardening.mjs`. Fixture'lar test sırasında geçici dizinde üretilir; OOXML değişiklikleri yalnız testlerde JSZip ile yapılır.

## Bulgu bazında kapanış

| #   | Uygulama / sözleşme                                                               | Test ve fixture kanıtı                                                                                      | Komut / kalan sınır                          |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Açık/otomatik UTF decode daima fatal                                              | EH `CSV security and limits`: bozuk UTF-8/LE/BE, BOM matrisi                                                | T geçti                                      |
| 2   | 2 worker, 8 kuyruk, 2 s sorgu, 32 MiB heap, 64 KiB mesaj; iptal/kapanış temizliği | RW: patolojik pattern, paralel normal MCP, syntax/backreference/lookahead, queue, abort, shutdown, recovery | T geçti; platform CI bekliyor                |
| 3   | Özel dosya reddi, nonblocking POSIX açma, native handle sınırı                    | NS: FIFO/socket/directory, watchdog, descriptor kontrolü                                                    | T geçti; platform CI bekliyor                |
| 4   | Sonluluk, metrik bazlı durum, taşma hatası                                        | EH `numeric and predicate contracts`: 1e400, sum/avg/stddev taşması, boş toplam ve gerçek sıfır             | T geçti                                      |
| 5   | Tür etiketli min/max, karma türde hücre bilgili hata                              | EH karma sayı/metin, ters sıra ve case matrisi                                                              | T geçti                                      |
| 6   | `between` tür/sıra/case doğrulaması tarama öncesinde                              | EH `uses the requested case policy…`, uyumsuz sınırlar matrisi                                              | T geçti                                      |
| 7   | Snapshot parser'ları göreli yol kullanır; beklenmeyen hata metni dışarı çıkmaz    | FH `error boundary`, mevcut Excel/core error testleri                                                       | T geçti                                      |
| 8   | Rich-text hyperlink ortak scalar normalizasyonu                                   | EH gerçek sharedStrings rich text + hyperlink OOXML fixture'ı, handler yanıtı                               | T geçti                                      |
| 9   | Resim listesi/tamlığı kısmi olarak etiketlenir                                    | EH absoluteAnchor fixture'ı: boş liste kesin yokluk sayılmaz                                                | T geçti; EXCEL-META-009 açık                 |
| 10  | Kaybolan formula CF eşiği `unsupported`, yanıltıcı sayı/null yok                  | EH `$A$1` cfvo fixture'ı ve handler                                                                         | T geçti; EXCEL-META-010 açık                 |
| 11  | Validation `errorStyle` korunur                                                   | EH `reports all errorStyle variants…`: stop/warning/information gerçek dosyalar                             | T geçti                                      |
| 12  | Declared table yatay kapsamı ve aday belirsizliği                                 | EH `selects the horizontally relevant table…`, mevcut header testleri                                       | T geçti                                      |
| 13  | Letter mode önce çözümlenir                                                       | EH `keeps letter mode independent from duplicate headers`                                                   | T geçti                                      |
| 14  | Boş kayıt ve fiziksel sıra korunur, boş ilk header uyarısı                        | EH `preserves blank records…`, başlangıç/orta/son boş CSV kayıtları                                         | T geçti                                      |
| 15  | Materialize öncesi quote-aware 16.384 alan sınırı                                 | EH dört delimiter, escaped quote ve multiline girdiler; RS 16.385 alan reddi                                | T geçti                                      |
| 16  | Header ve veri aynı merge politikasını kullanır                                   | EH yatay table + dikey merge fixture'ı, handler                                                             | T geçti                                      |
| 17  | Gerçek byte/hücre sınır dalları çalıştırılır                                      | EH tam 16 MiB/+1 ve 2.000.000 hücre/+1 parser ve handler; decode öncesi Proxy kontrolü                      | T geçti                                      |
| 18  | Registry çözümleme, unsupported extension ve names dedup                          | FH `resolves formats, rejects extensions and deduplicates format names`                                     | T geçti                                      |
| 19  | Handle üzerinden artımlı, tüm girdileri sayan tarama                              | NS 5.001 desteklenmeyen dosya, depth/time; FH liste bütçeleri                                               | T geçti; platform CI bekliyor                |
| 20  | Eksik kolon adı `null`; pozisyon ve uyarı korunur                                 | EH `preserves missing middle table-column positions through get_tables`: table1.xml ortadaki name eksik     | T geçti                                      |
| 21  | Formula/hyperlink notlarında `truncatedFrom`                                      | EH `retains formula and hyperlink truncation facts`, 603 karakter rich-text handler fixture'ı               | T geçti                                      |
| 22  | `orderByMetric` gerçek metrik sayısına göre doğrulanır                            | EH `rejects an out-of-range metric index with multiple groups`                                              | T geçti                                      |
| 23  | Eşleşen/dönen/atlanan satır sayaçları ayrılır                                     | EH `makes returned and omitted row accounting explicit`                                                     | T geçti                                      |
| 24  | Validation sayımı snapshot'a bağlı cache, 5.000 girdi bütçesi, nullable kesinlik  | EH `keeps validation counts bounded…`; RS gerçek sqref A2:A5002 parse/describe ölçümü                       | T geçti; ExcelJS parse maliyeti ayrı ölçülür |
| 25  | Defined names tamlık/scope kaybı açıklanır                                        | EH aynı local isimlerin iki sheet'te bulunduğu gerçek workbook.xml fixture'ı                                | T geçti; EXCEL-META-025 açık                 |
| 26  | Exact case/NFC seçimi, gerçek isim önerileri                                      | EH `preserves exact case and detects both NFC-colliding names in a real file`                               | T geçti                                      |
| 27  | Cursor v2 seçenek bağlama; omit/same/different, v1 reddi                          | EH cursor matrisi, CSV encoding/delimiter, farklı maxCells; mevcut cursor/read-sheet testleri               | T geçti; v1 uyumsuzluğu changelog'da         |
| 28  | Her erişimde güvenli byte okuması; SHA-256 aynı parse byte'larından               | EH `revalidates bytes on a cache hit…` ve ayrı cursor testi; aynı boyut + geri yüklenen mtime               | T geçti; atomik OS snapshot iddiası yok      |
| 29  | Serileştirme sınırında message/recovery mutlak yol arındırması                    | FH kardeş/başka kök, Windows, boşluklu yol; göreli yol/URL korunur                                          | T geçti                                      |
| 30  | Kök handle'a bağlı native bileşen erişimi; güvenli fallback yok                   | NS leaf/ancestor değişimi, inward/outward link, loop, root rename ve dış secret                             | T geçti; Linux/Windows runtime CI bekliyor   |
| 31  | Boolean/enum varsayılanları ve cursor kısıtları tool açıklamalarında              | `src/tools.ts` sözleşme incelemesi; mevcut tools testleri ve type-check                                     | T/F geçti                                    |
| 32  | Liste tool açıklaması CSV içerir                                                  | `src/tools.ts` sözleşme incelemesi; P gerçek CSV MCP çağrısı                                                | T/P/F geçti                                  |
| 33  | Gerçek NFC çakışan iki sheet korunur; sessiz ilk eşleşme yok                      | EH NFC fixture'ı; `ambiguous_sheet` branch hit                                                              | T geçti                                      |
| 34  | `totalExact`, `scanTruncated`, `scanTruncationReason`; sayfa kesimi ayrı          | FH `distinguishes traversal truncation from a result page`, sınır matrisi                                   | T geçti                                      |
| 35  | 1900/1904 bağımsız sabit oracle                                                   | EH `uses independent serial date oracles…`: 2024-01-01, 45292/43830 seri, .5 saat kesri, handler            | T geçti                                      |

## Kaynak ölçümleri

Yerel macOS arm64 / Node 24.12.0 tek çalıştırma örnekleri; performans garantisi değildir. Watchdog testleri tekrar üretir ve peak RSS kaydeder.

| Senaryo                                                | Sonuç                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| Tam 16 MiB CSV parse                                   | 2.479 ms                                                     |
| 16.385 alan reddi                                      | 0,82 ms                                                      |
| Gerçek sqref fixture parse / describe / cache describe | 8,93 / 1,66 / 0,042 ms                                       |
| Kaynak fixture süreci peak RSS                         | 230.512 KiB                                                  |
| Patolojik regex sırasında normal MCP                   | 0,624 ms; regex süreci toplam 2.293 ms, peak RSS 122.288 KiB |
| Native leaf/ancestor yarışının 10 tekrarı              | 8.000 okuma; dış secret okunmadı                             |
| Liste bütçesi                                          | 5.000 ziyaret; `entries` kesimi, peak RSS 89.568 KiB         |

Dosya yetkilendirmesi başlangıç kök handle'ına bağlıdır. Eşzamanlı yazıda metadata/kimlik değişimi reddedilir; atomik işletim sistemi snapshot'ı garantisi verilmez. Ayrıcalıklı mount değişimleri ve aynı kökte önceden yetkili hardlink'ler ayrı bir güvenlik sınırı değildir; ayrıntılar native paket README'sinde.

## Teslimat ve XML geçiş kapısı

Yerel kaynak, test ve paket doğrulamaları tamamlandı. CI dosyası hazır; Linux glibc x64/arm64, macOS x64 ve Windows x64 çalıştırmaları ile Node 22 sonuçları henüz yok. Beş hedefin hazır binary'leri ve temiz kurulum kanıtı CI'dan alınmadan, A paketinin platform kapsamı kapanmış sayılmayacak. Bu çalışma paket yayımlamaz.

#9/#10/#25 tam destek olarak işaretlenmez. Aşağıdaki üç bağımsız takip kaydı mevcut sınırlılığı, fixture'ı ve kapanış kriterini taşır; runtime `followUp` kimlikleri bu kayıtlara bağlanır. XML parser/tool veya ExcelJS değişimi yapılmadı.

## Zorunlu takip işleri

### EXCEL-META-009 — Absolute-anchor resim desteği

Mevcut teslimat yalnız desteklenen anchor sonuçlarının kısmi olabildiğini bildirir.
Takip işi: boyut/entry/derinlik bütçeli güvenli OOXML manifest okuması; absoluteAnchor resmini ve ilişkisini eksiksiz döndürme.
Kabul: absoluteAnchor + oneCellAnchor + twoCellAnchor içeren gerçek fixture, sayım/konum/ilişki doğruluğu; bozuk/dış ilişkiler güvenli reddedilir; tamlık yalnız kanıtlandığında true olur.

### EXCEL-META-010 — Formula CF eşiklerinin korunması

Mevcut teslimat kaybolan formula eşiklerini unsupported olarak bildirir.
Takip işi: güvenli OOXML okumasıyla cfvo formula metnini sayıdan ayrı koruma.
Kabul: `$A$1` eşikli colorScale/dataBar gerçek fixture'ları; formül birebir korunur; NaN/null sayısal eşik gibi sunulmaz; kaynak bütçeleri ve bozuk metadata testleri geçer.

### EXCEL-META-025 — Sheet-local defined name kapsamı

Mevcut teslimat ExcelJS isim listesinin eksik olabildiğini bildirir.
Takip işi: güvenli OOXML okumasıyla `(name, localSheetId)` kimliğini koruma.
Kabul: iki sayfada aynı local isim + global isim gerçek fixture'ı; üç tanım scope ve formülleriyle korunur; dış ilişkiler çözülmez; tamlık garantisi test edilir.
