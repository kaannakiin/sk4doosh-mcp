# XML MCP kararları

Durum: XML mimarisi kararları. Güncelleme: 2026-09-10. F0 kapısı geçti; **K1, K3, K4, K5, K6, K7 ve K8 `packages/xml-mcp` kodunda uygulanmış durumdadır**. K2'nin yedi tool'u da çalışıyor: F3 yarısı (`select_xpath`, `project_records`, `aggregate_document`) da uygulandı ve platform kanıtı bekliyor. Global kayıtlar [karar 016](../kararlar/016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md), [karar 017](../kararlar/017-xml-dugum-modeli-ve-yanit-sayfasi.md), [karar 018](../kararlar/018-xpath-ve-kayit-projeksiyonu.md) ve [karar 019](../kararlar/019-buyuk-dosya-ve-kademe.md); mevcut global ADR numaraları değiştirilmez.

## K1 — Birincil motor: libxml2-wasm

Küçük ve orta boyutlu belgeler için `libxml2-wasm` seçildi. F0-01 ile `0.7.2` tam sürüme sabitlendi ve [10/10 platform CI](f0-kanit-kaydi.md) ile kabul edildi; sürüm, bütünlük değeri, iki ayrı lisans katmanı, artifact'ı üreten commit ve gömülü libxml2 `2.15.1` sürümü [bağımlılık karar ekinde](bagimlilik-karar-eki.md) kayıtlıdır. Araştırmadaki `^0.7.2` ifadesi sabitleme değildi ve kullanılmadı.

Önceki devirdeki kaynak incelemesi (`394487987eece208b5d02274fedc6c292f84ee6b`, `0.8.0-dev`) **dağıtılan artifact değildir**: doğrulanmış SLSA provenance, `0.7.2`'nin `6e4dc82a323b6d27f2b3aca6dbec868949be83b7` commit'inden üretildiğini gösteriyor. Kaynak okumasındaki API olguları bu nedenle kurulu artifact üzerinde ayrıca ölçüldü.

Gerekçe: byte girdisi alan `XmlDocument.fromBuffer`, namespace destekli XPath 1.0 ve DOM aynı API altında bulunuyor. Böylece başlangıçta ayrıca XML encoding tahmini, DOM adaptasyonu ve başka bir XPath motoru birleştirmek gerekmiyor. Paket yerel derleme gerektiren bir bağlayıcı yerine WASM dağıtıyor. Ancak byte desteği bütün encoding varyasyonlarının doğru işlendiğinin kanıtı değildir; F0 fixture kapısı zorunludur. [Resmi README](https://github.com/jameslan/libxml2-wasm), [document API kaynağı](https://github.com/jameslan/libxml2-wasm/blob/394487987eece208b5d02274fedc6c292f84ee6b/src/document.mts).

### Alternatif karşılaştırması

| Seçenek                                | Uygun tarafı                                                             | Bu planın tercihi                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libxml2-wasm`                         | Byte → DOM → namespace/XPath tek motor; manuel kaynak ömrü yönetilebilir | İlk tercih; encoding, disposal, worker ve dağıtım kapılarıyla                                                                                                           |
| `@xmldom/xmldom` + `xpath`             | JS tabanlı DOM ve XPath 1.0 alternatifi                                  | WASM dağıtımı F0'da başarısız olursa ikinci değerlendirme; decoder ve motor uyumu ayrıca kanıtlanır                                                                     |
| `slimdom` + `fontoxpath`               | XPath 3.1/XQuery isteyen kullanım için güçlü aday                        | 3.1 gereksinimi henüz yok; ilk ürünün karmaşıklığına eklenmez                                                                                                           |
| `fast-xml-parser`                      | XML/nesne dönüşümü odaklı aday                                           | Namespace kimliği, karışık içerik ve XPath temel ihtiyaçları için ilk motor değil                                                                                       |
| `sax`                                  | Olay tabanlı sınırlı tarama için aday                                    | **Reddedildi** ([K19-7](../kararlar/019-buyuk-dosya-ve-kademe.md)): JS string üzerinde çalışır, byte offseti üretmez ve değer üretir. Sınır tarayıcısı in-house yazılır |
| `libxmljs2` / Java tabanlı doğrulayıcı | Farklı dağıtım koşullarında değerlendirilebilir                          | Yerel derleme veya Java kurulumu gereksinimi bu ürünün kurulum hedefiyle uyuşmaz                                                                                        |

Alternatiflerin güncel güvenlik durumu hakkında Claude raporundaki CVE sayıları burada tekrar edilmez. Advisory yokluğu güvenlik kanıtı değildir; npm wrapper kadar gömülü libxml2 sürümü de değerlendirilmelidir. Karşılaştırmanın ayrıntılı geçmişi [kaynak kaydında](kaynaklar.md).

## K2 — Başlangıçta dört tool; XPath sonraki kapı

**Dördü F2'de, üçü F3'te uygulandı.** `list_documents`, `describe_document`, `read_node`, `find_in_document`; ardından `select_xpath`, `project_records`, `aggregate_document`. Namespace haritası `describe_document` içinde sunulur; başlangıçta ayrı `get_namespaces` gerekmez. `project_records` tekrarlanan düğümlerden açık sütun seçimi yapar; tablo çıkarımının kullanıcıya açıklanmayan sezgilere dayanmasını önler ve tekrar kümesi bir örnek elementten sezgisel türetilmez. F3'ün sözleşme kararları [karar 018](../kararlar/018-xpath-ve-kayit-projeksiyonu.md)'dedir; kanıt [F3 kapanış kaydında](xml-f3-kapanis.md).

Claude'un domain özetindeki 14 satırlık ilk faz listesi MVP olarak alınmadı. ZIP, formatlama, çift yönlü dönüşüm, diff ve XSD özeti kendi test yükleriyle F5'e ayrıldı. Güçlü sorgulama tasarımının tamamı ilk yayın için zorunlu tutulmadı.

## K3 — Namespace URI kimliktir

**Uygulandı (F2-04/05).** `describe_document` her URI için kararlı alias veriyor ve boş olmayan default namespace her zaman sentetik alias alıyor; adres `{namespaceUri, localName, occurrence}` üçlüsüyle çözülüyor. Kanıt [F2 kapanış kaydında](xml-f2-kapanis.md).

Adlar `{namespaceUri, localName}` çiftiyle değerlendirilir. Prefix yalnızca belge içindeki gösterimdir; yeniden bağlanabilir. Canonical düğüm adresi namespace kimliğini ve aynı genişletilmiş ada sahip kardeşlerin sırasını korur. Sırf `local-name()` ile üretilmiş adresler kabul edilmez.

XPath 1.0'da prefixsiz element adı, varsayılan namespace'e otomatik bağlanmaz. `describe_document` kararlı sentetik prefix önerir; `select_xpath` açık prefix → URI haritası kullanır. Motor ifadeyi kullanıcıdan habersiz yeniden yazmaz. Boş sonuç başarıdır; olası default namespace hatası ayrı tanı olarak dönebilir, sorgu sessizce tekrar çalıştırılmaz. [XPath namespace API](https://github.com/jameslan/libxml2-wasm/blob/394487987eece208b5d02274fedc6c292f84ee6b/src/xpath.mts).

Araştırmadaki `agnostic` varsayılanı reddedildi: aynı local name farklı URI'lerde farklı alanları gösterebilir. İleride namespace'siz arama istenirse açık opt-in ve çakışma bildirimi gerekir; F3 sözleşmesine dahil değildir.

## K4 — Veri kaybını saklamayan okuma

**Uygulandı (F2-06).** Baştaki sıfır, büyük tamsayı, ondalık ve `false`/`0` string olarak dönüyor; whitespace trim edilmiyor; CDATA text'ten ayrı bir `kind` taşıyor. Ölçülen bir sessiz kayıp bu madde sayesinde yakalandı ve düzeltildi: düz `next` yürüyüşü ilk processing instruction'da duruyordu (kapanış kaydında **M12**).

Ham metin string kalır. Başında sıfır olan kimlik, büyük tamsayı, ondalık tutar ve tarih kendiliğinden JS değerine çevrilmez. Mixed content'te text/element sırası korunur; attribute'lar ayrı sunulur. Eksik düğüm, boş element ve boş text aynı değere indirgenmez.

DOM'dan XML serileştirme byte-exact kaynak değildir. XML görünümü sunulursa `representation: serialized` olarak etiketlenir; tırnak, entity yazımı, satır sonu ve XML declaration korunması vaat edilmez. C14N ve kaynak hash'i farklı amaçlardır; hash semantik eşitlik veya imza doğrulama sağlamaz.

## K5 — Parse ve sorgu ana event loop'u bloke etmez

F0-06 doğruladı: `fromBuffer` senkrondur, `Promise.race` tek başına işi durdurmaz (terminate edilmeyen işte CPU 1,0008), `worker.terminate()` senkron WASM çalışmasını keser (terminate sonrası CPU 0,0004) ve sonraki normal çağrı çalışır. [Kanıt](f0-kanit-kaydi.md).

Parse dahil maliyetli işler worker içinde yürütülür. İlk uygulama tek etkin worker, en fazla 5 derinlikli bekleme kuyruğu ve istek başına 2 saniyelik süre bütçesiyle teslim edildi. Kuyruk kapısı **okumadan önce** alınır; böylece bekleyen istek snapshot byte'ı pinlemez. `Promise.race` senkron parser'ı durdurmaz; timeout sonrasında worker sonlandırılır, çıkışı beklenir, ilgili snapshot'lar geçersizleşir. [Node worker yaşam döngüsü](https://nodejs.org/api/worker_threads.html#workerterminate).

`worker.resourceLimits` toplam RSS veya WASM bellek tavanı değildir; JS motoru sınırlarıdır ve dış bellek dahil edilmez. Bu nedenle “256 MiB worker limiti = süreç en fazla 256 MiB” iddiası kullanılmaz. Byte sınırı, eşzamanlılık, kuyruk ve ölçülmüş RSS birlikte izlenir; eşzamanlı DOM'ların şişme katsayısı **F2-10'da ölçüldü**: kaynak byte'ı başına 9,25–10,08× (düz, attribute-yoğun, derin), relative MAD ≤ 0,0047. 8 MiB tavanda kalıcı belge başına ≈ 81 MiB; `documentCacheSize` S=4 ve türetilen W=2S=8 ile worker tarafındaki en kötü hâl ≈ 645 MiB. Knob bir bütçedir, yaptırım değildir. [Ölçüm](xml-f2-kapanis.md). Kesin süreç bellek izolasyonu gerektiren dağıtımda OS/container sınırı veya ayrı süreç tasarımı ayrıca gerekir. F0 bunu karşılamıyorsa limitsiz üretim vaadiyle ilerlenmez. [Node Worker seçenekleri](https://nodejs.org/api/worker_threads.html#new-workerfilename-options).

## K6 — XML kaynaklarının sahibi worker

F0-07 doğruladı: paket `diag` tanı namespace'i sunuyor ve dispose'ta girişi siliyor, yani disposal ikili olarak ölçülebilir. Altı yaşam döngüsü olayının hepsinde 0 canlı instance ve `garbageCollected` 0. Worker ölümü tahsis ettiğinin tamamını geri veriyor. Bu nedenle `file-core`'a disposal hook'u **gerekmiyor**: store yalnız serileştirilebilir handle tutar, DOM worker'da kalır. [Kanıt](f0-kanit-kaydi.md).

Resmi README `dispose()` gerektiriyor. Mevcut `file-core` store'u Map girdisini siler; Loaded nesnesi için disposal hook'u yoktur. Dolayısıyla WASM DOM'u olduğu gibi bu store'a koymak uygun değil. [Resmi kaynak ömrü uyarısı](https://github.com/jameslan/libxml2-wasm#memory-management), [mevcut store](../../packages/file-core/src/documents.ts).

F0/F1 worker'ın DOM ve derlenmiş XPath nesnelerini sahiplenmesini kanıtlar. Ana süreçte yalnız seri hale getirilebilir sonuçlar veya sınırlı yaşam süresi olan kimlikler taşınır; WASM pointer'ı geçirilmez. Normal bitiş, hata, LRU tahliyesi, içerik/seçenek değişimi, worker ölümü ve shutdown ayrı yaşam döngüsü olaylarıdır. Worker kendi kaynağını serbest bırakır.

**Ölçülen sonuç: `file-core`'a disposal hook'u eklenmedi ve gerekmedi.** `packages/xml-mcp` store'a yalnız serileştirilebilir bir handle koyuyor ve `createDocumentStore` bu değişiklikte hiç değişmedi; altı yaşam döngüsü olayının hepsinde canlı instance sayısı 0 ölçüldü. Handle'ın serileştirilebilirliği `JSON.parse(JSON.stringify(loaded))` eşitliğiyle mekanik olarak sınanıyor. Worker'ın belge haritası **stamp** ile anahtarlanır: aynı boyut ve restore edilmiş mtime ile içerik değiştiğinde yeni anahtar oluşur ve eski belge ekleme anında dispose edilir. Bu madde artık koşullu değildir; hook'u yeniden gündeme getirmek için store'da gerçekten WASM kaynağı tutan yeni bir tüketici gerekir ve XML kavramları hiçbir koşulda çekirdeğe taşınmaz. [Ölçüm](xml-f1-kapanis.md).

## K7 — Dosya sandbox'ı ile XML çözümleyicisi iki ayrı sınır

F0-05 doğruladı: `xmlRegisterFsInputProviders` paket kökünde yok, yalnız `lib/nodejs.mjs` yan modülünde. Yan modülü **import etmek** sağlayıcı kaydetmiyor — K7'nin "modül adından erişim sonucu çıkarılmaz" uyarısı ampirik olarak cevaplandı. Sağlayıcı açıkça kaydedildiğinde canary ateşliyor, `xmlCleanupInputProvider()` ile geri alınıyor. [Kanıt](f0-kanit-kaydi.md).

Kullanıcının seçtiği dosya için ortak erişim sınırı uygulanmıştır: `file-core-native` başlangıçta açılan kök handle'ına bağlı okur; `file-core` parser'a `ParseContext.bytes`, `stamp` ve göreli `displayPath` sağlar. Boyut sınırı, özel dosya reddi, symlink/ancestor yarışı ve içerik değişimi regresyonları beş hedef × Node 22/24 CI'ında geçti. XML worker bu snapshot'ı tüketiyor ve `path` üzerinden dosyayı yeniden açmıyor; worker girişi `file-core`'u hiç import etmez ve bunu bir lint sınırı zorlar. F1-06 bağlantı testleri bunu gerçek MCP yanıtına kadar sabitliyor. [Kanıt](xml-f1-kapanis.md).

Parser'a dış entity, DTD, XInclude veya şema için genel dosya/ağ resolver'ı verilmez. `xmlRegisterFsInputProviders` ve eşdeğer geniş sağlayıcılar MVP'de kullanılmaz. Kaynak modülde bu kayıt açık bir fonksiyondur; yalnız modül adından “import tek başına erişim açar” sonucu çıkarılmaz. [Node sağlayıcı kaynağı](https://github.com/jameslan/libxml2-wasm/blob/394487987eece208b5d02274fedc6c292f84ee6b/src/nodejs.mts).

`NOENT`, `DTDLOAD`, `DTDATTR`, `DTDVALID`, `HUGE`, recovery ve XInclude işleme başlangıçta kapalıdır. Uygulama, DOCTYPE içeren belgeyi **parse etmeden önce**, ana süreçte çalışan prolog tarayıcısıyla reddeder; yorum/CDATA/PI içindeki aynı karakterler gerçek declaration sayılmaz. `doc.dtd` yalnız ikinci bir denetim katmanıdır ve birincil kapı olamaz: ölçüldü ki `XML_PARSE_NO_XXE` internal DTD subset'ini engellemiyor, yani `doc.dtd` okunabildiğinde internal entity zaten genişlemiş oluyor. Bu politika güvenli parser ayarlarının yerine geçmez. DTD'siz XML yolu F0'da yerel dosya ve ağ canary'leriyle kanıtlanır; DTD kullanan belge aileleri başlangıçta desteklenmez.

## K8 — Sınırlar sonuç semantiğini değiştirir

**Uygulandı (F2-06/07/08).** Sayfa bütçesi ölçüldü; `totalMatches` yalnız tam taramada, kesik taramada `scannedCount` + `matchedSoFar` dönüyor; cursor `stamp`'e bağlı ve içerik değişince reddediliyor. Bütçenin süreçler arası bölüşümü [karar 017](../kararlar/017-xml-dugum-modeli-ve-yanit-sayfasi.md)'dedir.

Satır sayısı sınırı tek başına payload sınırı değildir. Bütün yanıt, hata ve snippet'ler byte bütçesine tabidir. `totalMatches` yalnız tarama bittiyse exact olabilir; kesilen taramada toplam gibi gösterilmez. Cursor sorgu, seçenekler, dosya snapshot'ı ve tool ile bağlıdır; aynı dosya değiştiğinde eski cursor yanlış veri üretmek yerine reddedilir.

Bu bütçe artık `file-core`'da zorunlu yoldur: her tool yanıtı — başarı, hata ve recovery dahil — `coreLimits.maxPayloadBytes` kapısından geçer ve ürünlerin kendi sayaçlarına bırakılmaz. Ürün sayacı daha erken durdurabilir, kapıyı devre dışı bırakamaz.

Snapshot hash'i okunan byte'ların kimliğidir; dosyanın bütün okuma boyunca değişmediğini tek başına garanti etmez. Ön/son metadata kontrolü değişiklik şüphesini yakalar; eşzamanlı dış yazara karşı atomik dosya snapshot'ı vaat edilmez.

## K9 — Streaming aynı XPath'in ucuz hali değildir

**Karara bağlandı ([karar 019](../kararlar/019-buyuk-dosya-ve-kademe.md)).** Yaklaşım streaming değil, kayıt sınırından parçalamadır: `libxml2` tek semantik otorite kalır, tarayıcı yalnız byte konumu üretir ve yanlış kesim parse zamanında gürültülü hata verir. Kayıt içinde tam DOM ve XPath 1.0 korunur.

Bu maddenin sınırı aynen geçerlidir: genel XPath eksenleri, global sıralama ve bütün belge bilgisi isteyen aggregate işlemleri bütçe üstünde `unsupported` döner; parçalama bunları kurtarmaz. Karakter offset'i byte offset'i değildir — parçalı kademe bu yüzden UTF-16'yı açık kodla reddeder. "Offset index ile sonraki aralığı parse et" önerisi artık karara bağlıdır, ama indeks **baştan kurulmaz**: önce sınırlı yeniden tarama ve maliyet açıklaması, indeks ancak ölçüldükten sonra ve bütçesiyle.

## K10 — XML ve Excel görev paylaşımı

Excel sheet, hücre, tablo, formül cache değeri ve grid metaverisi `excel-mcp` alanıdır. XML MCP, ileride ZIP içindeki XML parçasını okursa Excel grid yorumlamasını tekrarlamaz. Yazma API'si olmaması mevcut salt okunur paketlerde bug değildir. XML'e özgü encoding/namespace/DOM nesnesi generic util'e taşınmaz. İkinci somut tüketici artık var ve ortaklaştırma **ölçülerek** yapıldı: çekirdeğe yalnız yanıt bütçesi kapısı ile BOM tablosu girdi. `EncodingName` birleşimi, `TextDecoder` kullanımı ve `undecodable_text` hâlâ tek tüketicili olduğu için taşınmadı. Gerekçe [karar 016](../kararlar/016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md).
