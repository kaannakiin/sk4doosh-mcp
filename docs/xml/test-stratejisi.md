# XML MCP test ve agent değerlendirme planı

Durum: F0 kapsamındaki XML testleri uygulandı ve [10/10 platform CI](f0-kanit-kaydi.md) ile geçti (T05/T06 → F0-04, T07/T08 → F0-05, T09 → F0-05/08, T16 → F0-06, T17 → F0-07). F1 kapanışıyla **T08, T15, T16 ve T17'nin ürün kodu ayakları** uygulandı. **F2 kapanışıyla T01, T02, T03, T04, T12'nin cursor ayağı, T13'ün sayfa ayağı ve T14 kapandı**; kanıt [F2 kapanış kaydında](xml-f2-kapanis.md). **F3 kapanışıyla T18 ve T19 kapandı ve T01/T02/T04/T14/T16'nın F3 ayakları koştu**; kanıt [F3 kapanış kaydında](xml-f3-kapanis.md). Dört paketli toplam **712 test** (F2: 613, F1: 529), `xml-mcp` 40 → 124 → **223**. T21–T23 F5'e, T20 ve T24–T27 F4'e aittir ve açıktır (2026-09-10). T20 [karar 019](../kararlar/019-buyuk-dosya-ve-kademe.md) ile yeniden tanımlandı: parçalamada karşılaştırılacak ikinci motor yok, DOM/streaming parity yerine kalıcı/parçalı diferansiyel oracle geçti. Agent kabul kaydı F2-09 ile alındı; XML benchmark'ı hâlâ yok.

T10/T11/T15'in XML uzantı ve handler ayakları `packages/xml-mcp/test` içinde uygulandı ve ortak dosya katmanı regresyonlarıyla birlikte koşuyor. T12'nin içerik değişimi ayağı worker tarafında F1'de, cursor ayağı F2-06'da kapandı; T13'ün sayfa ayağı F2-08'in ölçümüyle kapandı. Excel regex worker testleri T09 veya XML disposal testlerinin yerine geçmez. Bulgu bazlı sonuçlar [kapanış kaydında](excel-hardening-uygulama.md); aşağıdaki T kimlikleri XML kabul görevleri olarak açık kalır.

## Katmanlar ve sahiplik

| Katman                  | Testin yeri                                  | Ne doğrular?                                                                                              |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Native erişim           | `packages/file-core-native/test`             | Kök handle'ı, özel dosya ve symlink/ancestor/UNC watchdog regresyonları; mevcut CI'da geçti               |
| Generic dosya davranışı | `packages/file-core/test`                    | Sandbox, gerçek byte sınırı, listeleme, cache/cursor base davranışı ve hata arındırma; mevcut CI'da geçti |
| XML anlamı              | `packages/xml-mcp/test`                      | Parser policy, DOCTYPE kapısı, namespace, sıralı içerik, adres ve arama uygulandı; sorgu F3 ile genişler  |
| XML bağlantısı          | `packages/xml-mcp/test`                      | Registry/vocabulary/error factory/file-core entegrasyonu; generic suite kopyası değil — 123 test          |
| Worker ve kaynak        | XML entegrasyon testi, izole süreç           | Timeout/cancel/shutdown, disposal, kuyruk, sonraki isteğin sağlığı                                        |
| MCP protokolü           | Gerçek istemciyle stdio testi                | Şema, anotasyon, tool yanıtı, error, stdout ve cancellation                                               |
| Agent görevi            | Fixture manifesti ve kayıtlı tool transcript | Doğru bilgiye az çağrı ve kontrollü çıktı ile ulaşma                                                      |

XML fixture'ları format ürününde tutulur; HTTP spec/conformance paketine format runtime bağımlılığı eklenmez. Doğrulama generic mantığın sahibi olan pakette yapılır. Doğrudan paket testi stale dependency dist kullanmamalı; Turbo build bağımlılıklarıyla çalışır.

## Zorunlu matris

| Test kimliği | Fixture / senaryo                                                  | Beklenen invariant                                                                          | Kapı                |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------- |
| T01 ✅       | Namespace yok/default namespace/prefix değişimi                    | Aynı URI+localName aynı kimlik; farklı URI karışmaz                                         | F0-03, F2-04, F3-01 |
| T02 ✅       | Aynı local name iki URI, prefix rebinding, namespace'siz attribute | Adres ve XPath doğru düğümü seçer; boş sonuç otomatik başka semantik çalıştırmaz            | F2-04, F3-04        |
| T03 ✅       | Text-element-text, CDATA, comment, PI, xml:space                   | Sıra ve metin anlamı korunur; atılan biçim açık; trim ile veri kaybı yok                    | F2-04/06            |
| T04 ✅       | Boş element, eksik element, boş string, 0, false, büyük kimlik     | Eksik/boş ayrışır; otomatik sayı/tarih dönüşümü yok                                         | F2-06, F3-02/05     |
| T05          | UTF-8/UTF-16LE/BE BOM'lu ve BOM'suz                                | Desteklenen kombinasyon doğru Unicode; unsupported açık hata                                | F0-04               |
| T06          | Bozuk UTF, declaration yalanı, NUL, kesilmiş byte                  | Sessiz replacement/recovery yok; encoding vs malformed hata ayrımı belgeli                  | F0-04, F2-02        |
| T07          | Dış entity/DTD, parameter entity, XInclude, schemaLocation         | Host dış dosya ve ağ canary erişimi sıfır; DOCTYPE politika gereği reddedilir               | F0-05, F2-02        |
| T08          | Yorum/CDATA içinde DOCTYPE benzeri metin                           | Geçerli belge yanlışlıkla DTD diye reddedilmez                                              | F0-05               |
| T09          | Çok derin, attribute-heavy, dev text, entity bomb                  | Bütçeli başarısızlık; ana süreç ve sonraki normal istek sağlıklı                            | F0-05/06/08         |
| T10          | XML uzantılı dizin/FIFO, symlink ve parent yarışı                  | Gerçek dosya ve sandbox şartı; platforma uygun sınırlı süre; dış byte yok                   | F1-01/02            |
| T11          | Okurken büyüyen/değişen dosya                                      | Byte sınırı actual read üstünde; değişiklik hatası veya belgeli snapshot sınırı             | F1-02/04            |
| T12 ✅       | Aynı boyut ve restore edilmiş mtime ile içerik değişimi            | Eski cache/cursor yanlış yeni belgeye uygulanmaz                                            | F1-04, F2-06        |
| T13 ✅       | Çok küçük sayfa; envelope sınırını aşan UTF-8 snippet              | Her sayfa ilerler veya açık hata; total payload limit altında                               | F1-05, F2-06/08     |
| T14 ✅       | Cursor tool/sorgu/options değiştirme, bozma, expiry                | Yapılandırılmış invalid/stale hata; yetki veya gizli seçenek override yok                   | F2-06, F3-03        |
| T15          | Çok sayıda desteklenmeyen dosya ve unreadable giriş                | Bütün ziyaretler bütçeli; exact olmayan toplam işaretli                                     | F1-07, F2-03        |
| T16          | Parse/query timeout, queued cancellation, shutdown                 | İş gerçekten durur; Promise timeout'u arkasında çalışmaz; kaynaklar kapanır                 | F0-06, F2-02, F3-03 |
| T17          | Tekrarlanan aç/kapat/eviction/error/compiled query                 | Disposal ve bellek trendi beklenen; stale pointer veya double-free yok                      | F0-07               |
| T18 ✅       | XPath empty/node-set/scalar/NaN/Infinity, yanlış sürüm             | Tür kaybı ve sessiz null yok; 2.0+ istek açık unsupported                                   | F3-02/04            |
| T19 ✅       | Mixed numeric/text, hassasiyet, eksik/çoklu sütun, grup kesme      | Crash yok; dönüşüm/atlama/yuvarlama sayıları ve toplam kapsamı doğru                        | F3-05/06            |
| T20          | Aynı fixture'ın kalıcı ve parçalı kademe sonucu                    | Değer ve `occurrence` dizisi eşit; parça sınırı sonucu değiştirmez                          | F4-L2/L3            |
| T21          | XSD cycle/include dış yol, unresolved type, invalid schema         | Outline belirsizliği görünür; resolver dışarı çıkmaz; invalid belge ile engine failure ayrı | F5-S1–S4            |
| T22          | ZIP bomb, duplicate/path traversal/encrypted entry                 | Sınırdan önce tam açılım yok; host yoluna extract yok                                       | F5-C1–C3            |
| T23          | Mixed content format/JSON dönüşümü/önden kardeş ekleme diff        | Anlam değişimi saklanmaz; loss/matching politikası testli                                   | F5-D1–D4            |
| T24          | CDATA/comment/PI içinde sahte kayıt etiketi, attribute içinde `>`  | Sınır tarayıcısı yanlış kesmez; `<![CDATA[</e><e>]]>` iyi-biçimli yanlış parça üretmez      | F4-L2               |
| T25          | UTF-16 belge parçalı kademede                                      | Açık kodla reddedilir; byte tarayıcısı iki byte'lı `<` üzerinde sessizce kesmez             | F4-L2               |
| T26          | Parça sınırına denk gelen sayfalama                                | Aralıklar ikişerli ayrık ve birleşimleri tüm kardeş dizisi; exactly-once bozulmaz           | F4-L3/L5            |
| T27          | Kullanıcı korpusunda belge şekli anketi                            | Bütçe üstü dosyaların kayıt-şekilli oranı ölçülür; K19-3'ün varsayımı sınanır               | F4-L0               |

## Fixture önceliği

İlk set: namespace'li ve namespace'siz `.csproj`, `pom.xml`, `.config`, `.resx`, JUnit, sentetik UBL benzeri belge ve mixed-content örneği. İkinci set: TRX, coverage XML, SOAP/WSDL, XLIFF. Sonraki set: XBRL, SVG, DocBook ve arşiv içi parçalar yalnız ilgili fazda.

F2 fixture'ları `packages/xml-mcp/test/fixtures/build.ts` içinde üretiliyor; agent senaryolarının beklenen düğüm ve değerleri `test/fixtures/manifest.ts`'te **önceden** yazılı. Bu öncelik yasal zorunluluk veya pazar büyüklüğü iddiasına dayanmaz; namespace, attribute, tekrar, iç içe kayıt ve mixed content çeşitliliğine dayanır. Gerçek müşteri secret/verisi fixture olarak alınmaz. Her fixture için kaynak/lisans veya sentetik üretim açıklaması, byte hash'i, encoding ve beklenen sonuç kaydı tutulur.

## Property ve karşılaştırma testleri

- Namespace prefix'lerini URI değiştirmeden yeniden adlandırınca semantic seçim sonucu aynı kalır.
- Sonuç sayfalarının birleşimi aynı snapshot ve aynı derinlik/görünüm seçenekleriyle üretilen küçük-fixture sonucu ile aynıdır; tekrar/kayıp yoktur. `nodeId` tekildir; ancestor context tekrar eklenmez; text/element/comment/PI kardeş sırası `childIndex` ile korunur. Derinlikte atlanan çocuklar yalnız daha derin ayrı okumada gelir, devam cursor'ıyla gelmiş sayılmaz.
- Attribute sırası değişimi kimlik değiştirmez; mixed content çocuk sırası değişimi fark oluşturur.
- Literal arama arbitrary text'i sorgu dili olarak çalıştırmaz.
- Rastgele malformed girdide sonuç ya bütçeli hata ya beklenen geçerli belgedir; crash/hang yoktur. Fuzz denemelerinin süre, seed ve küçültülmüş regresyon örneği kaydedilir.
- Ürün paketinin kendi dış-I/O canary'si `packages/xml-mcp/test/external-io.spec.ts`'tedir ve F0-05'in harness ölçümünü ürün yolunda tekrarlar. Mutasyonla sınandı ve **ne kanıtladığı ölçüldü**: worker import denylist'i `libxml2-wasm/lib/nodejs.mjs` eklendiğinde kırmızıya döner, DOCTYPE reddi prolog kapısı devre dışı bırakıldığında kırmızıya döner. Buna karşılık XInclude, `schemaLocation` ve katalog PI assertion'ları parse policy, prolog kapısı ve fs provider'ın üçü birden kapatıldığı mutasyonda bile yeşil kaldı: canary içeriği hiçbir mutasyonda çıktıya ulaşmadı. Bu üçü **sızıntı dedektörü değil, davranış regresyon dedektörüdür**; "dosya yolu kaçmıyor" iddiasını taşımazlar. İddiayı taşıyan kanıt F0-05'in ağ/dosya canary'si ve DOCTYPE'ın parse öncesi reddidir.
- İkinci XML motoruyla differential test yalnız teşhis aracıdır; iki motor aynı hatayı yapabilir. Nihai oracle fixture beklentisi ve standardın ilgili kuralıdır.

## Agent değerlendirme cetveli

| Görev                                 | Beklenen sonuç                                     | Ölçümler                                                 |
| ------------------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| Pom içinden belirli bağımlılık sürümü | Doğru namespace ve bağımlılık, kaynak adresi       | Doğruluk, çağrı sayısı, byte, gereksiz tam belge okuması |
| Sentetik faturadan satır kimlikleri   | Sıra, baştaki sıfırlar ve tutar metni korunur      | Veri kaybı sayısı, kesilme bildirimi                     |
| JUnit başarısız testleri              | Yalnız failure/error kayıtları; skipped ayrı       | False positive/negative, açık eksik kapsam               |
| Boş XPath / yanlış namespace          | Boş sonuç veya yararlı tanı; yanlış URI cevabı yok | Recovery başarısı, tekrar sayısı                         |
| Oversized veya malformed XML          | Yapılandırılmış hata ve uygulanabilir sonraki adım | Hata doğruluğu, sonraki çağrı sağlığı                    |

Hedef: golden görevlerde yanlış alan/değer sıfır; namespace çakışmasında sessiz eşleşme sıfır; desteklenmeyen işlemi destekleniyormuş gibi gösterme sıfır. Çağrı sayısı ve latency baseline ölçülmeden “% daha hızlı” iddiası kullanılmaz. Model adı, sürümü, tool açıklamaları ve fixture seti kaydedilir; bir modelin başarısı API doğruluğunun yerine geçmez.

## Kapanış kanıtı şablonu

Her XML görev kaydı şu alanları içerecek: görev kimliği, durum, commit/artifact, test komutu, ortam, fixture kimlikleri, beklenen/gerçek sonuç, gerekiyorsa elapsed/peak RSS, kalan sınır ve inceleyen. Şablon ilk kez F1 kapanışı için dolduruldu: [XML F1 kapanış kaydı](xml-f1-kapanis.md); ikincisi [XML F2 kapanış kaydıdır](xml-f2-kapanis.md). Excel/file-core için doldurulmuş bulgu/test/fixture ve CI kayıtları [kapanış belgesinde](excel-hardening-uygulama.md) bulunur.
