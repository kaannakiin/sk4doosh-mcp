# F1 — Ortak çekirdek ve Excel düzeltme paketleri

Durum: Excel/file-core güvenlik kapsamı yerelde uygulandı; platform CI ve XML'e özgü işler bekliyor. Sorumlu: file-core/Excel geliştiricisi. Önkoşul: [bulgu raporu](../excel-file-core-bulgular.md). XML motoruna özgü yaşam döngüsü için F0 sonucu gerekir.

## Hedef

XML ikinci tüketici olurken mevcut dosya sınırlarını güçlendirmek. Excel'e özgü düzeltmeleri ayrı paketlerde tutmak. Excel/file-core uygulaması `b4924d8` commit'inde; 449 yerel test ve temiz paket/MCP doğrulaması geçti. Bu sonuç bütün F1 fazının veya XML işlerinin tamamlandığı anlamına gelmez.

## Güncel ilerleme

| Görev / kapsam                                             | Durum ve kanıt                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| F1-01/02 native erişim, özel dosya ve snapshot byte sınırı | macOS arm64 / Node 24 geçti; Linux/Windows dahil platform matrisi bekliyor          |
| F1-04 içerik kimliği, cache ve cursor                      | Yerel regresyonlar geçti; atomik OS snapshot iddiası yok                            |
| F1-07 artımlı listeleme                                    | Gerçek ziyaret, derinlik/süre ve toplam kesinliği testleri yerelde geçti            |
| Excel bulguları #1–35                                      | Uygulama/test/sınırlılık kaydı tamamlandı; #9/#10/#25 tam destek takipleri açık     |
| F1-03 XML DOM/WASM kaynak sahipliği                        | Bekliyor; Excel regex worker uygulaması XML motoru yaşam döngüsünün kanıtı değildir |
| F1-05 ortak hata redaksiyonu                               | Yerelde doğrulandı; bütün XML başarı yanıtlarının byte bütçesi henüz uygulanmadı    |
| F1-06 iki tüketicili regresyon                             | file-core/Excel testleri geçti; XML tüketicisi ve entegrasyonu bekliyor             |

Bulgu/test/fixture eşleştirmesi [kapanış kaydında](../excel-hardening-uygulama.md). [Platform testleri rehberi](../excel-platform-testleri.md) GitHub Actions'ta Linux ve Windows çalıştırma adımlarını açıklar. Platform ve paket kanıtı gelmeden XML geliştirmesine geçilmez. Aşağıdaki tablolar görevlerin kabul sözleşmesini korur.

## XML başlamadan kapanacak kapılar

| Görev | İş / hedef modül                                                      | Kabul ölçütü                                                                                                                                                                                                    |
| ----- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1-01 | Açılan dosyanın sandbox kimliği: `file-core/paths.ts`, `documents.ts` | Resolve/open arasındaki değişim, symlink'li parent, platform farkları kontrollü fixture'larla değerlendirilir. Açılmış handle yeniden yol açmadan tüketilir; verilen tehdit modelinde sandbox dışı byte dönmez. |
| F1-02 | Gerçek okuma byte sınırı ve dosya türü: `documents.ts`                | Ön stat yeterli sayılmaz; büyüyen dosya limit üstünde okunmaz. Özel dosya/FIFO açılışı bloke etmez veya desteklenmeyen platform davranışı açıkça sınırlandırılır. Hata halinde handle kapanır.                  |
| F1-03 | Kaynak sahipliği: worker + `createDocumentStore` entegrasyonu         | DOM/compiled query nesnesinin tek sahibi belli; eviction/error/shutdown serbest bırakır. Ana sürece WASM pointer'ı taşınmaz. Generic hook gerekiyorsa format bağımsız tasarlanır.                               |
| F1-04 | Snapshot ve cursor/cache tutarlılığı                                  | Aynı boyut/mtime ile değişen içerik yanlış devam sayfası vermez. Hash okunan byte'lardan üretilir; fingerprint yalnız cache ipucu olabilir. Eşzamanlı yazımın sınırı belgelenir.                                |
| F1-05 | Bütün yanıtlar için byte bütçesi ve hata redaksiyonu                  | Liste, başarı, hata ve recovery alanları envelope dahil limite uyar; mutlak root/stack sızmaz. Tool'a özgü pagination XML katmanında kalır.                                                                     |
| F1-06 | İki tüketicili regresyon ve paket sınırı                              | Excel davranışları korunur; generic testler file-core'da kalır. XML terimleri/file-core → core bağımlılığı eklenmez.                                                                                            |

F1-01/02 iddiaları [bulgu raporundaki](../excel-file-core-bulgular.md) koşullarıyla değerlendirilir. Statik yarış penceresi görmek bütün işletim sistemlerinde exploit kanıtı değildir; doğrulama görevi kapının parçasıdır. Salt okunur dosya sunucusunun erişim sınırı buna rağmen “yerel saldırgan olmaz” varsayımıyla sessizce bırakılmaz.

### F1-07 — Artımlı listeleme ve toplam semantiği

`listing.ts`: recursive readdir ile bütün ağaç önce materialize edilmez. Bütün ziyaretler bütçeye sayılır; eksik tarama gerçek toplam gibi sunulmaz; bulgu #19 ve #34 birlikte kapanır. Kabul: büyük ve çoğunlukla desteklenmeyen dosyalar içeren ağaçta ziyaret/byte/süre sınırı uygulanır; eksik toplam açıkça bildirilir.

## Excel'e özgü bağımsız iş grupları

| Görev | Kapsam                                                | Kabul ölçütü                                                                                                                    |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| F1-E1 | CSV encoding, parse ve kayıt boyutu                   | BOM/encoding politikasında bozuk veri sessiz değişmez; büyük tek kayıt süreç sınırını aşmaz; boş CSV açık davranış üretir       |
| F1-E2 | Predicate/aggregate tür ve hata davranışı             | Yanlış tür crash veya JSON'da sessiz null üretmez; boş küme/overflow/NaN sözleşmesi testli                                      |
| F1-E3 | Header, sütun, range ve tablo çözümü                  | Boş/tekrarlı header konumu korunur; adsız tablo sütunu indeks kaydırmaz; implicit header beklentisi mevcut düzeltmeyle çakışmaz |
| F1-E4 | read_sheet cursor ve arama bütçesi                    | Cursor ile değişen seçenek açık davranış verir; ReDoS riski kontrollü izolasyonla giderilir; sayfa kaybı/tekrarı yok            |
| F1-E5 | Workbook, conditional format ve validation metaverisi | Unsupported özellik gerçekmiş gibi türetilmez; kapsam eksiklikleri çıktı veya dokümanda açık                                    |
| F1-E6 | Şema, doküman ve eksik regresyonlar                   | Her kapatılan bulgunun davranış odaklı testi var; salt read-only tasarım eksik write API diye değiştirilmez                     |

35 orijinal bulgunun güncel sınıflandırması, dosya/satır kanıtı ve ilgili grup eşlemesi bulgu raporunda tutulur; bu tablo yeni bulgu sayımı değildir. Doğrulanamayan veya tasarım tercihi olan madde önce karar alır, doğrudan kod değişikliğine dönüşmez.

Bulgu raporundaki grupların görev eşlemesi: F1-A → F1-01/02/05/07; F1-B → F1-E1; F1-C → F1-E2/E4; F1-D → F1-E3/E4; F1-E → F1-E5; F1-F → F1-04/06/E6. XML kaynak sahipliği F1-03, eski 35 bulguya ek entegrasyon gereksinimidir.

## Doğrulama ve bağımlılıklar

2026-09-08 kullanıcı kararları: #26'da mevcut NFC/kesin sayfa adı eşleştirmesi ve yanlış adda öneri korunacak; harf duyarsız otomatik fallback eklenmeyecek. #27'de cursor'a bağlı seçeneğin açıkça farklı verilmesi yapılandırılmış hata döndürecek; gönderilmeyen seçenek cursor'dan devralınacak, aynı değerin tekrarı kabul edilecek. #28'de Excel cache yeniden kullanımı ve cursor devamı gerçek içerikle doğrulanacak; ek okuma maliyeti kabul edildi. Bu kararlar sırasıyla F1-E5/E6, F1-E4/E6 ve F1-04/E6 kabul ölçütlerine dahildir. Üç kararın ayrıntısı [karar kaydında](../excel-acik-maddeler-karar-kaydi.md).

Uygulama sırasında ilgili paket testleri repo kuralına göre Turbo üzerinden yürür; bağımlılık build'ini atlayan doğrudan paket testi kanıt sayılmaz. Generic değişiklikte file-core ve Excel tüketici regresyonu birlikte çalışır; XML paketi oluştuğunda onun bağlantı testleri de eklenir.

XML için çıkış: F1-01–07'nin kullanılan yolda kapanması. Excel grupları paralel tamamlanabilir; yalnız XML'in tükettiği ortak kusurlar MVP kapısıdır. Public API değişiyorsa bağımsız paket sürümleme ve tüketici geçişi F6'da kayıt altına alınır.
