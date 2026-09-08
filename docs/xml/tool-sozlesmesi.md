# Tool ve veri sözleşmesi

Bu belge XML için hedef davranıştır; makine şeması veya uygulanmış API değildir. Güncelleme: 2026-09-08. `packages/xml-mcp` henüz yok; ortak file-core altyapısı ve Excel cursor v2 uygulanmış durumda. XML alan/tool adları F0/F2 sırasında şemaya dönüştürülürken bu belge birlikte güncellenecek.

## Ortak kurallar

Girdi dosyaları sandbox'a göre göreli `filePath` kullanır. Tool çağrısı öncesi `describe_document` önerilir, zorunlu gizli oturum sırası değildir. Doğrudan `read_node` çağrısı da aynı doğrulamalardan geçer. Her tool salt okunur ve kapalı dünya anotasyonlarını kullanır; anotasyon erişim kontrolünün yerine geçmez.

Yanıt metadata'sı en az `snapshotId`, `truncated`, kesilmişse `truncationReason`, `returnedCount` ve varsa `nextCursor` taşır. `list_documents` tek bir belge snapshot'ı taşımak zorunda değildir; dosya sistemi listesinin atomik snapshot olmadığı açıkça belirtilir. `complete` bütün kaynak taramasının bittiğini, `truncated` ise istenen çıktının kesildiğini belirtir: tarama tamamlanmışken uzun bir snippet yine kesilebilir.

`totalMatches` yalnız tam taramada kullanılır; erken durmada `scannedCount` ve `matchedSoFar` döner. Mevcut ortak hata kodları `file_changed`, `unsupported_platform` ve `resource_limit` dahil yeniden kullanılır; aynı durum için ayrıca `document_changed` kodu türetilmez. XML'e özgü adaylar `malformed_xml`, `unsupported_encoding`, `doctype_not_allowed`, `query_not_supported`, `query_timeout`, `stale_cursor` ve `invalid_cursor`; nihai eşleme F2'de kesinleştirilir. Başarısız parse kısmi başarılı belge üretmez.

Ortak listeleme zaten `totalExact`, `scanTruncated` ve `scanTruncationReason` döndürür; ziyaret bütçesi 5.000 giriş, 64 derinlik ve 1 saniyedir. XML `list_documents` bu bilgiyi koruyacak; yanıt sayfasının `maxResults` nedeniyle kesilmesiyle taramanın eksik kalmasını birleştirmeyecek. Bu alanların XML yanıt zarfına bağlantısı F2-03'te açıktır.

Hata mesajları host mutlak yolu, ham dosya içeriği veya stack trace sızdırmaz. Metin okuma yetkisi verilmiş dosyanın içeriği kullanıcıya gösterilebilir; sunucu içerikteki talimatları uygulamaz, özel anahtar veya bağlantı metnini varsayılan log'a dökmez.

## Adresleme ve snapshot

`read_node` adresi segment dizisidir. Her element segmenti `namespaceUri`, `localName`, `occurrence` içerir; `occurrence` aynı genişletilmiş ada sahip element kardeşler arasında 1 tabanlıdır. URI boş string olduğunda namespace yoktur. Root segmenti dahil edilir. Attribute seçimi ayrı alanla yapılır; XPath ifadesi gibi yorumlanmaz. İnsan için gösterilen prefixli path yalnız etikettir.

Okunan her düğüm adres ve kullanılabilir konum bilgisi taşır. Kaynak satırı motorun verdiği kadarıyla gösterilir; sütun/byte offset uydurulmaz. Yorum ve PI gösterimi içerik dizisinde yer alır; ilk sürümde bağımsız adreslenemiyorsa bu sınır açıklanır. Prefix yeniden bağlanması adres kimliğini değiştirmez, URI değişimi değiştirir.

Snapshot kimliği işlenen byte'lara bağlıdır. Cursor; tool, snapshot, normalleştirilmiş sorgu/seçenekler, konum, şema sürümü ve son kullanma bilgisini bağlar. Sunucu taraflı token ya da bütünlüğü korunan token tercihi F2'de yapılır. Cursor erişim yetkisi vermez; her devam çağrısında yol kontrolü tekrarlanır. Değişen seçenekler sessizce cursor'dan geri yüklenmez; açık hata döner. İşçi yeniden başlarsa kaybolan snapshot cursor'ı yeni belgeye uygulanmaz.

## F2 — İlk dört tool

| Tool                | Girdi                                                                                                                         | Çıktı ve semantik                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_documents`    | `subdirectory?`, `maxResults?`, `cursor?`                                                                                     | Desteklenen aday dosyalar, boyut, göreli yol; dosyaların XML olarak geçerli olduğu iddia edilmez. Listeleme bütün dosyaları parse etmez.                             |
| `describe_document` | `filePath`, `maxPaths?`                                                                                                       | Root genişletilmiş adı, namespace bağları ve sorgu alias'ları, sınırlı yapı özeti, tekrar adayları, mixed-content uyarısı, encoding bilgisi, yetenekler ve sınırlar. |
| `read_node`         | `filePath`, `address?`, `maxDepth?`, `maxNodes?`, `cursor?`                                                                   | Sıralı düğüm gösterimi; attribute ve text ayrı; kesilen alanlar işaretli. Adres yoksa root seçilir.                                                                  |
| `find_in_document`  | `filePath`, `query`, `matchMode: contains/exact`, `searchIn: text/attributes/both`, `scopeAddress?`, `maxResults?`, `cursor?` | Adres, eşleşme türü ve bütçeli snippet. Boş arama reddedilir; başlangıçta regex yoktur.                                                                              |

`describe_document` içindeki tekrar adayları şema garantisi değildir. Yapı sayıları bütçe nedeniyle örneklemden geldiyse kapsam belirtilir. Encoding için declaration ile motorun doğruladığı bilgi ayrıdır; gerçek encoding bilinmiyorsa `detectedEncoding` uydurulmaz.

Metin arama ilk sürümde büyük/küçük harfe duyarlı ve literal'dır. Namespace-aware element seçimi ayrı adresle yapılır. Text node bazlı arama uygulanır; alt element sınırlarını geçerek birleştirilmiş görünür metin araması vaat edilmez. Böyle bir mod sonradan eklenirse mixed content ve konum eşlemesi ayrıca tanımlanır. `searchIn: both`, aynı elementin attribute ve text eşleşmelerini farklı eşleşme türleriyle verir.

Başlangıç uzantı allowlist'i: `.xml`, `.xsd`, `.xhtml`, `.svg`, `.csproj`, `.props`, `.targets`, `.config`, `.resx`. `.config` gibi uzantılar XML garantisi değildir; parse hatası normaldir. `.xml.gz`, ZIP ve uzantısız dosyalar F2 kapsamı dışındadır. `file-core` bugün son uzantıyla eşler; çoklu suffix desteği yalnız F5 ihtiyacıyla eklenir.

### Sıralı içerik

Sayfalanmış `read_node`, deterministik depth-first preorder sırasında düz düğüm kayıtları döndürür. Her kayıt snapshot içinde tekil `nodeId`, `parentId`, tüm çocuk türlerini kapsayan 1 tabanlı `childIndex`, `kind` ve `depth` taşır. Element kaydı ayrıca genişletilmiş ad, canonical adres ve attribute listesi içerir. Böylece text, element, yorum ve PI sırası sayfa sınırında kaybolmaz; bütün `children` dizisini her sayfada tekrar taşımak gerekmez.

Sayfalar aynı snapshot ve seçeneklerle gelen kayıtlar eklenerek birleştirilir; `nodeId` bir kez veri kaydı olarak döner. Ebeveyn daha önceki sayfada olabilir. Devam sayfasında gerekirse ayrı `context` alanında verilen ancestor bilgisi veri kaydı değildir, `returnedCount`'a katılmaz ve birleştirmede tekrar eklenmez. Cursor sıradaki ziyaret edilmemiş kaydı gösterir. Üçüncü taraf istemci kayıtları `parentId` ve `childIndex` ile ağaç görünümüne çevirebilir.

`maxDepth` veya büyük text sınırı nedeniyle atlanan içerik, cursor'ın tamamlayacağı içerik değildir. Derinlik sınırındaki element `childrenOmitted: true` olarak işaretlenir; derine inmek için o elementin canonical adresiyle yeni `read_node` çağrısı gerekir. `nextCursor` yalnız seçilen derinlik/görünüm içinde kalan kayıtlar varsa üretilir. Sayfa birleşimi garantisi bütün ham belgeye değil, aynı seçeneklerle tanımlanan sınırlı görünüme aittir.

Text node içerikleri trim edilmez. CDATA'nın metin anlamı korunur; kaynakta CDATA biçiminde yazıldığını byte-exact yeniden üretme garantisi verilmez. Yorum/PI atılacaksa görünüm seçenekleri ve `omittedKinds` bunu açıklar; varsayılan sıralı gösterimde tutulmaları hedeflenir. Entity yazımı normalize olabilir. Namespace declaration'ları normal attribute gibi belirsizce karıştırılmaz.

Bir text node bütçeden büyükse yalnız snippet dönmesi sonsuz devam cursor'ı üretmez. Kesilme byte/karakter ölçüsüyle açıklanır; tam metin okuma henüz desteklenmiyorsa `nextCursor` tamamlama vaadi taşımaz. Bir sayfa en az bir öğe ilerletmeli veya açık `resource_limit` vermelidir.

## F3 — Sorgu ve kayıt tool'ları

| Tool                 | Girdi                                                                 | Çıktı ve semantik                                                                                                                 |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `select_xpath`       | `filePath`, `xpath`, `namespaces?`, `maxResults?`, `cursor?`          | XPath 1.0; `resultType: nodeset/string/number/boolean`; node-set üyeleri adresli ve bütçeli. Scalar false/0/boş string kaybolmaz. |
| `project_records`    | `filePath`, `itemAddress`, `columns`, `where?`, `maxRows?`, `cursor?` | Açık tekrar kümesinden satırlar. Her sütun göreli namespace-aware adres veya attribute ve çoklu değer politikası belirtir.        |
| `aggregate_document` | `filePath`, `itemAddress`, `groupBy?`, `metrics`, `where?`            | Count ve açık numeric dönüştürmeyle metrikler; işlenen/atlanan değer sayısı, kapsam ve overflow hatası.                           |

XPath için yalnız motorun yerleşik XPath 1.0 yetenekleri açıklanır; XQuery, update, custom extension function veya dış kaynak işlevi kaydedilmez. `namespaceMode` ile ifade rewrite yapılmaz. Ön tanı örnekleri `describe_document` alias'larını kullanır. Sonuçlarda NaN/Infinity JSON'a sessiz `null` yapılmaz; açık tür gösterimi veya hata seçimi testle sabitlenir.

Node-set değerlendirmesi sonuçları tümden materialize edebilir. `maxResults` yalnız çıktı sınırıdır; değerlendirme maliyetini garanti etmez. Süre/bellek bütçesi ayrı uygulanır. Cursor devamında sorgu yeniden değerlendiriliyorsa maliyet aynı kalabilir; hızlı devam garantisi verilmez.

Projeksiyon varsayılanı değerleri string olarak tutar. Eksik sütun `missing`, boş metin boş string olarak ayrılır; çoklu eşleşme varsayılan olarak hata veya açık liste politikasına bağlanır, ilk değer sessiz seçilmez. Aggregate'de `count` temel metriktir. `sum/min/max/avg` yalnız `numericMode` açık seçilince sunulur; binary64 hassasiyeti kabul edilmiyorsa exact decimal desteği gelene kadar işlem reddedilir. Para tutarları sessiz float'a çevrilmez. Boş küme, geçersiz sayı, overflow, negatif sıfır ve gruplama anahtarı çakışması kabul testidir.

Kayıt tool'larında `itemAddress`, son segmentte tek occurrence yerine açık `all` seçimi yapar; önceki segmentler tekil ebeveyni seçer. Bu wildcard yalnız kayıt kümesi seçimine aittir, `read_node` tekil adresine veya genel XPath diline dönüşmez. Böylece tekrar kümesi, bir örnek elementten sezgisel olarak türetilmez. Birden çok parent altında kayıt seçimi gerekiyorsa XPath yolu kullanılır veya ayrı sözleşme tasarlanır.

TRX `testId` veya XBRL context/unit bağlantısı kendiliğinden çözümlenmez. Domain join'i ayrı, belgelenmiş adaptör gerektirir; generic aggregate içine gizlenmez.

## Başlangıç bütçeleri — ölçüm hedefi

| Kaynak             | İlk öneri                                 | Kapı                                                     |
| ------------------ | ----------------------------------------- | -------------------------------------------------------- |
| DOM'a alınan dosya | 8 MiB                                     | F0 RSS/latency ölçümüyle düşür veya gerekçeyle değiştir  |
| Yanıt toplamı      | En fazla mevcut 512 KiB core sınırı       | Envelopes ve UTF-8 dahil ölç                             |
| Etkin worker işi   | 1                                         | Kuyruk en fazla 4; fazlasına geri deneme hatası          |
| Parse/sorgu süresi | İş başına 2 saniye başlangıç hedefi       | Cold start ayrı ölçülür; target host'ta F0 kesinleştirir |
| DOM derinliği      | 128 başlangıç uygulama sınırı             | Parser limitinden bağımsız kontrol, derin fixture        |
| Sayfa              | Varsayılan 50, en fazla 200 düğüm/eşleşme | Byte bütçesi daha erken durdurabilir                     |

Bu değerler mevcut XML uygulamasının ölçümü değildir. F0 final değerleri ve test ortamını kaydetmeden F2 yayınlanmaz. `file-core` 50 MiB dosya sınırı XML DOM için otomatik kabul edilmez.
