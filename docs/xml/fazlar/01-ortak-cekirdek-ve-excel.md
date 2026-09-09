# F1 — Ortak çekirdek ve Excel düzeltme paketleri

Durum: **tamamlandı** (2026-09-09). Excel/file-core güvenlik ve platform kapısı `6b2bc89` ile geçmişti; kalan XML kapıları `packages/xml-mcp`'nin ilk teslimiyle kapatıldı ve `71cb388` için [CI #34330278812](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34330278812) 13/13 geçti. Ölçümler [F1 kapanış kaydında](../xml-f1-kapanis.md). Sorumlu: file-core/Excel geliştiricisi ve XML geliştiricisi; doğrulayan: entegrasyon/test inceleyicisi.

## Hedef

Excel/file-core güvenlik teslimi tamamlandı. Başlangıç uygulaması `b4924d8`, son kod düzeltmesi `4472332`; dokümanları içeren `6b2bc89` için [CI #34226587889](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34226587889) 13/13 geçti. Native/file-core/Excel toplamı 450 test; beş hedef × Node 22/24 ve birleşik paket/MCP doğrulaması başarılı. F1'in kalan işi olan XML bağlantısı da yapıldı: `packages/xml-mcp` `file-core`'u tüketiyor, XML kaynak ömrü worker'da ölçüldü ve yanıt zarfı bütçesi `file-core`'da zorunlu yol oldu.

## Güncel ilerleme

| Görev / kapsam                                             | Durum ve kanıt                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| F1-01/02 native erişim, özel dosya ve snapshot byte sınırı | Beş hedef × Node 22/24 platform matrisi ve paket doğrulaması geçti                                                             |
| F1-04 içerik kimliği, cache ve cursor                      | Tamamlandı; aynı boyut/mtime değişimi dahil platform CI geçti; atomik OS snapshot iddiası yok                                  |
| F1-07 artımlı listeleme                                    | Tamamlandı; ziyaret, derinlik/süre ve toplam kesinliği regresyonları platform CI'da geçti                                      |
| Excel bulguları #1–35                                      | Uygulama/test/sınırlılık kaydı tamamlandı; #9/#10/#25 tam destek takipleri açık                                                |
| F1-03 XML DOM/WASM kaynak sahipliği                        | Uygulandı; worker sahipleniyor, altı yaşam döngüsü olayında da 0 canlı instance ölçüldü, `file-core` disposal hook'u eklenmedi |
| F1-05 ortak hata redaksiyonu ve yanıt bütçesi              | Uygulandı; 512 KiB zarf kapısı `file-core`'da zorunlu yol, XML liste/hata/recovery zarfları ölçüldü                            |
| F1-06 iki tüketicili regresyon                             | Uygulandı; `packages/xml-mcp` ikinci tüketici, dört paketli kabul komutu 529 testle geçti                                      |

Bulgu/test/fixture/commit eşleştirmesi [kapanış kaydında](../excel-hardening-uygulama.md). [Platform rehberi](../excel-platform-testleri.md), main push veya manuel GitHub Actions çalıştırmasını açıklar. Aşağıdaki tablolar bütün F1 işlerinin kabul sözleşmesini tutar; tamamlanan ortak katman yeniden yapılacak iş değildir.

## XML kapıları — kapanış sözleşmesi

| Görev | İş / hedef modül                                                                                | Kabul ölçütü                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1-01 | Tamamlandı: `file-core-native/src/secure.cc`, `file-core/access.ts`, `paths.ts`, `documents.ts` | Kök handle'ına bağlı dosya/dizin erişimi; leaf/ancestor değişimi ve kök dışı symlink/UNC reddi platform watchdog testlerinde doğrulandı. Parser pathname ile yeniden açmaz.                                                                                                                                                                                            |
| F1-02 | Tamamlandı: native sınırlı snapshot ve `documents.ts` format limiti                             | Boyut sınırı okumadan önce ve okuma sırasında uygulanır; özel dosyalar reddedilir. Ön/son kimlik/metadata değişiminde `file_changed`; hata yollarında kaynak temizliği testli.                                                                                                                                                                                         |
| F1-03 | Uygulandı: XML worker kaynak sahipliği; `createDocumentStore` değişmedi                         | DOM ve derlenmiş sorgu nesnesinin tek sahibi worker'dır. Normal bitiş, hata, LRU tahliyesi, içerik/seçenek değişimi, worker ölümü ve shutdown'ın altısında da serbest bırakma `diag` oracle'ıyla ölçüldü. Ana sürece WASM pointer'ı taşınmıyor; store'a konan handle'ın serileştirilebilirliği testle sabit. `file-core`'a disposal hook'u **eklenmedi ve gerekmedi**. |
| F1-04 | Tamamlandı: snapshot ve Excel cursor/cache tutarlılığı                                          | SHA-256 parse edilen byte'lardan üretilir; her cache/Excel cursor kullanımında güvenli okuma yapılır. Aynı boyut/mtime içerik değişimi ayrı regresyonlarla doğrulandı. XML tarafında henüz cursor yoktur; bağlantısı F2-06'ya aittir.                                                                                                                                  |
| F1-05 | Uygulandı: ortak hata redaksiyonu ve yanıt zarfı bütçesi                                        | Ortak hata/message/recovery arındırması geçti. `file-core` her tool yanıtını — başarı, hata ve recovery dahil — `coreLimits.maxPayloadBytes` kapısından geçirir; kapı bir sabit değil, zorunlu yoldur. XML liste ve hata zarflarının byte'ları ölçüldü. Dört tool'un birlikte sayfa bütçesi F1'in değil, F2-08'in kapısıdır.                                           |
| F1-06 | Uygulandı: native/file-core/Excel/XML dört yönlü regresyon                                      | `packages/xml-mcp` gerçek ikinci tüketicidir: registry, snapshot ve hata bağlantısı gerçek handler ve MCP yanıtına kadar sınandı. `file-core`'a XML kavramı girmedi, `file-core → core` bağımlılığı eklenmedi; ikisi de testle sabit. Cursor bağlantısı XML tarafında henüz yoktur ve F2-06'ya aittir.                                                                 |

F1-01/02 için platform kanıtı alındı. Güvence kök handle'ına bağlı yetkilendirmedir; eşzamanlı dış yazara karşı atomik işletim sistemi snapshot'ı değildir. Desteklenen beş hedefte hazır native paket gerekir; desteklenmeyen platform açık hata verir ve güvensiz JavaScript fallback kullanılmaz.

### F1-07 — Artımlı listeleme ve toplam semantiği

Tamamlandı: `listing.ts` native handle üzerinden artımlı taramayı kullanır. Desteklenmeyen dosyalar dahil bütün ziyaretler 5.000 giriş, 64 derinlik ve 1 saniye bütçesine sayılır. `totalExact`, `scanTruncated`, `scanTruncationReason` tarama tamlığını bildirir; `maxResults` kesilmesi ayrı tutulur. #19/#34 regresyonları platform CI'ında geçti. XML `list_documents` alan eşlemesi F2-03 ile yapıldı; `totalExact`, `scanTruncated` ve `scanTruncationReason` XML yanıt zarfında birebir korunuyor ve `maxResults` kesilmesi ayrı `truncated` alanıyla bildiriliyor.

## Tamamlanan Excel iş grupları

| Görev | Kapsam                                                | Kabul ölçütü                                                                                                                    |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| F1-E1 | CSV encoding, parse ve kayıt boyutu                   | BOM/encoding politikasında bozuk veri sessiz değişmez; büyük tek kayıt süreç sınırını aşmaz; boş CSV açık davranış üretir       |
| F1-E2 | Predicate/aggregate tür ve hata davranışı             | Yanlış tür crash veya JSON'da sessiz null üretmez; boş küme/overflow/NaN sözleşmesi testli                                      |
| F1-E3 | Header, sütun, range ve tablo çözümü                  | Boş/tekrarlı header konumu korunur; adsız tablo sütunu indeks kaydırmaz; implicit header beklentisi mevcut düzeltmeyle çakışmaz |
| F1-E4 | read_sheet cursor ve arama bütçesi                    | Cursor ile değişen seçenek açık davranış verir; ReDoS riski kontrollü izolasyonla giderilir; sayfa kaybı/tekrarı yok            |
| F1-E5 | Workbook, conditional format ve validation metaverisi | Unsupported özellik gerçekmiş gibi türetilmez; kapsam eksiklikleri çıktı veya dokümanda açık                                    |
| F1-E6 | Şema, doküman ve eksik regresyonlar                   | Her kapatılan bulgunun davranış odaklı testi var; salt read-only tasarım eksik write API diye değiştirilmez                     |

F1-E1/E2/E3/E4/E6 tamamlandı. F1-E5 kabul edilen kapsamda tamamlandı: #9/#10/#25 için tam metadata desteği eklenmedi; yapılandırılmış sınırlılıklar ve EXCEL-META-009/010/025 takip işleri kaydedildi. Bunlar güvenlik kapısını yeniden açmaz ve tam destek olarak sayılmaz. 35 bulgunun güncel test/fixture kanıtı [bulgu raporunda](../excel-file-core-bulgular.md) ve [kapanış kaydında](../excel-hardening-uygulama.md).

Bulgu raporundaki grupların görev eşlemesi: F1-A → F1-01/02/05/07; F1-B → F1-E1; F1-C → F1-E2/E4; F1-D → F1-E3/E4; F1-E → F1-E5; F1-F → F1-04/06/E6. XML kaynak sahipliği F1-03, eski 35 bulguya ek entegrasyon gereksinimiydi ve `packages/xml-mcp` teslimiyle kapandı.

## Doğrulama ve bağımlılıklar

2026-09-08 kullanıcı kararları uygulandı ve test edildi: #26 kesin/NFC sayfa adı seçimi ve gerçek isim önerileri; #27 cursor v2'de gönderilmeyen seçeneği devralma, aynı değeri kabul etme ve farklı değeri reddetme; #28 cache ve cursor'da gerçek içerik doğrulaması. Ayrıntılar [karar kaydında](../excel-acik-maddeler-karar-kaydi.md).

Uygulama sırasında ilgili paket testleri repo kuralına göre Turbo üzerinden yürür; bağımlılık build'ini atlayan doğrudan paket testi kanıt sayılmaz. Generic değişiklikte file-core ve Excel tüketici regresyonu birlikte çalışır; `packages/xml-mcp` oluştuğu için onun bağlantı testleri de bu birlikte koşan kümededir.

F1'in bütün çıkış kapıları uygulandı: F1-01/02/04/07 platform CI ile, F1-03/05/06 ise `packages/xml-mcp`'nin ilk teslimiyle. F1'i kapatan XML işi **F2-01/02/03 görev kimlikleriyle** yürütüldü; kimlikler değişmedi ve F2'nin kalan işi F2-04–11'dir. Tamamlanan F1-01/02/04/07 artık XML bağlantı testlerinde de regresyondan korunuyor. `file-core` public API'si genişledi; sürüm numaraları ve gerekçesi [karar 016](../../kararlar/016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md)'da, ölçümler [F1 kapanış kaydında](../xml-f1-kapanis.md). Yayın kararı ve `file-core` 1.0 sorusu F6-08'dedir.
