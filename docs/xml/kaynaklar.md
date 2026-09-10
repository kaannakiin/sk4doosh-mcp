# Kaynaklar, devir izi ve kanıt sınırı

İlk araştırma devri: 2026-09-08, HEAD `f389cdd75d87cc7a17cc1fb0dddeb3789135dcd1`; o tarihte `docs/xml` yoktu. Bu bilgi tarihsel başlangıç kaydıdır. Güncel kaynak/doküman tabanı `6b2bc89`: Excel/file-core uygulaması, testleri ve platform CI tamamlandı; o tarihte XML uygulaması başlamamıştı. F0 ve F1'in XML kapıları sonradan kapandı ([F0](f0-kanit-kaydi.md), [F1](xml-f1-kapanis.md)). Güncel kanıt [CI #34226587889](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34226587889) ve [kapanış kaydında](excel-hardening-uygulama.md).

## Claude'un bıraktığı çalışma

Kaynak kökü: `/private/tmp/claude-501/-Users-kaanakin-Desktop-sk-mcp/dbbb29ba-f968-4c51-b7e4-639ea7303a3f/scratchpad/research`.

Kökteki konu dizinlerinin doğrudan Markdown envanteri: `xml-domain` 13, `xml-libs` 42, `audit` 10, `codebase` 4, `design` 4. Bunlar 73 Markdown dosyasıdır; kütüphane README'leri dahil olduğundan “73 bağımsız araştırma” demek değildir. İndirilmiş paket/node_modules ağaçları bu sayıya dahil değildir.

| Kaynak                               | Katkısı                                                               | SHA-256                                                            |
| ------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `xml-domain/DIGEST.md`               | Tool listesi, risk/test taslağı, belge aileleri, çözülememiş iddialar | `4bd3315a7e73bccc9ba9bee9b9c62b34446c58870c79ba2c29879638e5278898` |
| `xml-libs/VERDICT.md`                | Motor karşılaştırması ve eski seçim önerisi                           | `162af4e5112aab86b600bb1b7498841994d50982d56db7e0f19757c301dd9112` |
| `audit/excel-audit-report.md`        | 35 birleşik Excel/file-core bulgusu                                   | `685a3e77778eb007b68720bbb6e93e721ffcfbf5ee90f8a09ea54ed182d41705` |
| `design/design-mvp-first.md`         | Dört tool ve dar teslim                                               | `78572bc103eb18a087be47c548ac728ee1195035083755846714923caa8fe954` |
| `design/design-power-query-first.md` | XPath ve worker odaklı tasarım                                        | `879713f410d97c55aecb71a142cfa36a5d3eafcf0f640aa21628c897cd66976b` |
| `design/design-safety-first.md`      | Resolver, policy, provenance ve bütçeler                              | `09f7fb31fab7b0330669b61ec0353e4d39dbe21d6ffd14645e3831f063df6604` |
| `design/design-ergonomics-first.md`  | Keşif → hedefli okuma akışı ve recovery                               | `0b05159cb416afc47de6c6c1c8166a5655ee0c6427de8e169470259d1951689d` |

Ham raporlar bu klasöre birebir kopyalanmadı. Yukarıdaki geçici dizinin kalıcılığı garanti değildir; hash dosyanın kopyası değildir. Kararlar, karşılaştırma, bulgu matrisi ve uygulama görevleri bu repository belgelerinde kalıcı olarak özetlendi. Uygulama bu planları okuyarak başlayabilir; eski raporların tüm ayrıntıları gerektiğinde kaynak kökten erişilir.

## Birleştirilen tasarım kararları

| Eski çelişki                                        | Bu plandaki çözüm                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Dört tool MVP / çok geniş ilk faz                   | F2 dört tool; XPath F3; genişletmeler F5                                                                                       |
| Local-name-only veya namespace agnostic varsayılanı | Genişletilmiş ad ve explicit namespace map; sessiz XPath rewrite yok                                                           |
| NOENT açık/kapalı, DTD opt-in                       | F2 DOCTYPE reddi; expansion/resolver kapalı; getter davranışı dahil F0 doğrulaması                                             |
| Parser limitleri yeterli, worker gereksiz           | Parse dahil worker; iptal/cleanup kanıtı zorunlu                                                                               |
| Worker heap sınırı hard bellek sınırı               | JS heap ile RSS/WASM ayrı; kesin süreç sınırı vaat edilmiyor                                                                   |
| DOM'u mevcut cache'e koy                            | Worker kaynak sahibi; disposal eksikliği F1-03 görevi                                                                          |
| Streaming index ile genel read/query                | Kayıt parçalamaya dönüştü ([karar 019](../kararlar/019-buyuk-dosya-ve-kademe.md)); indeks baştan kurulmaz, arbitrary XPath yok |
| XML çıktı exact kaynak görünümüdür                  | Serializer sonucu kaynak byte'ı değildir; fidelity açık                                                                        |
| XSD özeti ucuz tam şema çözümüdür                   | Yalnız deklarasyon özeti; unresolved/cycle görünür; validation ayrı                                                            |

## Bu devirde kontrol edilen birincil kaynaklar

Kontrol tarihi 2026-09-08. GitHub master içeriği değişebilir; libxml2-wasm kaynak incelemesinin revision'ı `394487987eece208b5d02274fedc6c292f84ee6b`. Bu repository revision'ı ile npm artifact'ın birebir aynı olduğu ayrıca kanıtlanmadı; F0 paket kapısı bunu ele alır.

| Kaynak                                                                                                                        | Doğrulanan sınırlı bilgi                                             | Kanıt türü                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [npm libxml2-wasm metadata](https://registry.npmjs.org/libxml2-wasm/latest)                                                   | Kontrol anında `0.7.2`, npm lisans alanı MIT, Node engine `>=18`     | Canlı metadata; proje Node hedefi ayrıca 22/24                                             |
| [Resmi libxml2-wasm README](https://github.com/jameslan/libxml2-wasm/blob/394487987eece208b5d02274fedc6c292f84ee6b/README.md) | WASM yaklaşımı, buffer API ve açık disposal ihtiyacı                 | Resmi doküman                                                                              |
| [document.mts](https://github.com/jameslan/libxml2-wasm/blob/394487987eece208b5d02274fedc6c292f84ee6b/src/document.mts)       | fromString/fromBuffer ayrımı, parse seçenekleri, DOM/XPath girişleri | Kaynak incelemesi; fixture sonucu değil                                                    |
| [xpath.mts](https://github.com/jameslan/libxml2-wasm/blob/394487987eece208b5d02274fedc6c292f84ee6b/src/xpath.mts)             | Compile ve namespace map yüzeyi                                      | Kaynak incelemesi                                                                          |
| [nodejs.mts](https://github.com/jameslan/libxml2-wasm/blob/394487987eece208b5d02274fedc6c292f84ee6b/src/nodejs.mts)           | Genel filesystem sağlayıcısının ayrı kayıt fonksiyonu                | Kaynak incelemesi; canary testi F0-05'te yapıldı                                           |
| [disposable.mts](https://github.com/jameslan/libxml2-wasm/blob/394487987eece208b5d02274fedc6c292f84ee6b/src/disposable.mts)   | Kaynak yaşam döngüsünün ayrı soyutlaması                             | Kaynak incelemesi; leak ölçümü değil                                                       |
| [Node worker_threads](https://nodejs.org/api/worker_threads.html)                                                             | resourceLimits JS motoruna ilişkin; terminate yaşam döngüsü          | Resmi doküman; hedef Node sürümlerinde test F0'da                                          |
| [FontoXPath README](https://github.com/FontoXML/fontoxpath)                                                                   | XPath/XQuery 3.1 alternatifinin kullanım yüzeyi                      | Resmi doküman; ürün karşılaştırma benchmark'ı değil                                        |
| [sax README](https://github.com/isaacs/sax-js)                                                                                | Streaming olay parser'ı adayı                                        | **Reddedildi** ([K19-7](../kararlar/019-buyuk-dosya-ve-kademe.md)); byte offseti üretmiyor |

Node worker belgesi kontrol anında v26 dokümanıydı; planın Node 22/24 hedefi için sürüm uyumluluğu F0-02/06'da ayrıca sınanır. Wrapper npm lisansı ile gömülü libxml2 dağıtım lisansını tek metadata alanından eşitlemeyiz.

## Taşınmayan kesinlik iddiaları

Claude raporlarındaki advisory/CVE sayıları, yıldız/indirme sayıları, arşivlenme tarihleri ve bazı pazar/mevzuat iddiaları bu devirde bağımsız tam taramayla doğrulanmadı. Karar gerekçesine güvenlik puanı veya hukuki gerçek diye taşınmadı. “Sıfır CVE”, “WASM her bellek hatasını güvenle kapsüller”, “tüm encoding'ler doğru”, “streaming sınırsız bellek tasarrufu sağlar” gibi sonuçlar verilmez.

Excel bulgularının ilk statik sınıflandırması tarihsel denetim olarak korunur. Sonraki uygulama ve hedefli regresyon sonuçları [bulgu raporunun güncel durum bölümünde](excel-file-core-bulgular.md) ve [kapanış kaydında](excel-hardening-uygulama.md): 32 bulgu uygulama/test ile, #9/#10/#25 ise kabul edilen metadata sınırlılığı ve ayrı takiplerle ele alındı. Eski denetim satır numaraları güncel kaynak konumu sayılmaz. XML motoru için yukarıdaki kaynak incelemesi, F0 runtime kanıtı yerine geçmez.
