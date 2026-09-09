# XML MCP test ve agent değerlendirme planı

Durum: F0 kapsamındaki XML testleri uygulandı ve [10/10 platform CI](f0-kanit-kaydi.md) ile geçti (T05/T06 → F0-04, T07/T08 → F0-05, T09 → F0-05/08, T16 → F0-06, T17 → F0-07). F2 ve sonrasına ait T kimlikleri açık (2026-09-09). Ortak native/file-core/Excel testleri uygulanıp çalıştırıldı: 450 test ve beş hedef × Node 22/24 için [CI #34226587889](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34226587889) 13/13 başarılı. XML runtime testi, XML benchmark'ı ve agent kabul kaydı henüz yok.

T10/T11/T12/T15'in ortak dosya katmanı regresyonları mevcut; bu tablodaki XML uzantısı/handler/cursor bağlantısı ayrıca kanıtlanacak. Excel regex worker testleri T09 veya XML disposal testlerinin yerine geçmez. Bulgu bazlı sonuçlar [kapanış kaydında](excel-hardening-uygulama.md); aşağıdaki T kimlikleri XML kabul görevleri olarak açık kalır.

## Katmanlar ve sahiplik

| Katman                  | Testin yeri                                  | Ne doğrular?                                                                                              |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Native erişim           | `packages/file-core-native/test`             | Kök handle'ı, özel dosya ve symlink/ancestor/UNC watchdog regresyonları; mevcut CI'da geçti               |
| Generic dosya davranışı | `packages/file-core/test`                    | Sandbox, gerçek byte sınırı, listeleme, cache/cursor base davranışı ve hata arındırma; mevcut CI'da geçti |
| XML anlamı              | Gelecekte `packages/xml-mcp/test`            | Namespace, sıralı içerik, encoding, parser policy, adres ve sorgu                                         |
| XML bağlantısı          | Gelecekte `packages/xml-mcp/test`            | Registry/vocabulary/error factory/file-core entegrasyonu; generic suite kopyası değil                     |
| Worker ve kaynak        | XML entegrasyon testi, izole süreç           | Timeout/cancel/shutdown, disposal, kuyruk, sonraki isteğin sağlığı                                        |
| MCP protokolü           | Gerçek istemciyle stdio testi                | Şema, anotasyon, tool yanıtı, error, stdout ve cancellation                                               |
| Agent görevi            | Fixture manifesti ve kayıtlı tool transcript | Doğru bilgiye az çağrı ve kontrollü çıktı ile ulaşma                                                      |

XML fixture'ları format ürününde tutulur; HTTP spec/conformance paketine format runtime bağımlılığı eklenmez. Doğrulama generic mantığın sahibi olan pakette yapılır. Doğrudan paket testi stale dependency dist kullanmamalı; Turbo build bağımlılıklarıyla çalışır.

## Zorunlu matris

| Test kimliği | Fixture / senaryo                                                  | Beklenen invariant                                                                          | Kapı                |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------- |
| T01          | Namespace yok/default namespace/prefix değişimi                    | Aynı URI+localName aynı kimlik; farklı URI karışmaz                                         | F0-03, F2-04, F3-01 |
| T02          | Aynı local name iki URI, prefix rebinding, namespace'siz attribute | Adres ve XPath doğru düğümü seçer; boş sonuç otomatik başka semantik çalıştırmaz            | F2-04, F3-04        |
| T03          | Text-element-text, CDATA, comment, PI, xml:space                   | Sıra ve metin anlamı korunur; atılan biçim açık; trim ile veri kaybı yok                    | F2-04/06            |
| T04          | Boş element, eksik element, boş string, 0, false, büyük kimlik     | Eksik/boş ayrışır; otomatik sayı/tarih dönüşümü yok                                         | F2-06, F3-02/05     |
| T05          | UTF-8/UTF-16LE/BE BOM'lu ve BOM'suz                                | Desteklenen kombinasyon doğru Unicode; unsupported açık hata                                | F0-04               |
| T06          | Bozuk UTF, declaration yalanı, NUL, kesilmiş byte                  | Sessiz replacement/recovery yok; encoding vs malformed hata ayrımı belgeli                  | F0-04, F2-02        |
| T07          | Dış entity/DTD, parameter entity, XInclude, schemaLocation         | Host dış dosya ve ağ canary erişimi sıfır; DOCTYPE politika gereği reddedilir               | F0-05, F2-02        |
| T08          | Yorum/CDATA içinde DOCTYPE benzeri metin                           | Geçerli belge yanlışlıkla DTD diye reddedilmez                                              | F0-05               |
| T09          | Çok derin, attribute-heavy, dev text, entity bomb                  | Bütçeli başarısızlık; ana süreç ve sonraki normal istek sağlıklı                            | F0-05/06/08         |
| T10          | XML uzantılı dizin/FIFO, symlink ve parent yarışı                  | Gerçek dosya ve sandbox şartı; platforma uygun sınırlı süre; dış byte yok                   | F1-01/02            |
| T11          | Okurken büyüyen/değişen dosya                                      | Byte sınırı actual read üstünde; değişiklik hatası veya belgeli snapshot sınırı             | F1-02/04            |
| T12          | Aynı boyut ve restore edilmiş mtime ile içerik değişimi            | Eski cache/cursor yanlış yeni belgeye uygulanmaz                                            | F1-04, F2-06        |
| T13          | Çok küçük sayfa; envelope sınırını aşan UTF-8 snippet              | Her sayfa ilerler veya açık hata; total payload limit altında                               | F1-05, F2-06/08     |
| T14          | Cursor tool/sorgu/options değiştirme, bozma, expiry                | Yapılandırılmış invalid/stale hata; yetki veya gizli seçenek override yok                   | F2-06, F3-03        |
| T15          | Çok sayıda desteklenmeyen dosya ve unreadable giriş                | Bütün ziyaretler bütçeli; exact olmayan toplam işaretli                                     | F1-07, F2-03        |
| T16          | Parse/query timeout, queued cancellation, shutdown                 | İş gerçekten durur; Promise timeout'u arkasında çalışmaz; kaynaklar kapanır                 | F0-06, F2-02, F3-03 |
| T17          | Tekrarlanan aç/kapat/eviction/error/compiled query                 | Disposal ve bellek trendi beklenen; stale pointer veya double-free yok                      | F0-07               |
| T18          | XPath empty/node-set/scalar/NaN/Infinity, yanlış sürüm             | Tür kaybı ve sessiz null yok; 3.1 istek açık unsupported                                    | F3-02/04            |
| T19          | Mixed numeric/text, overflow, eksik/çoklu sütun, grup kesme        | Crash yok; dönüşüm/atlama sayıları ve toplam kapsamı doğru                                  | F3-05/06            |
| T20          | Aynı belgenin DOM ve streaming alt küme sonucu                     | URI/değer/sıra eşit; chunk/offset farkı sonucu değiştirmez                                  | F4-02/07            |
| T21          | XSD cycle/include dış yol, unresolved type, invalid schema         | Outline belirsizliği görünür; resolver dışarı çıkmaz; invalid belge ile engine failure ayrı | F5-S1–S4            |
| T22          | ZIP bomb, duplicate/path traversal/encrypted entry                 | Sınırdan önce tam açılım yok; host yoluna extract yok                                       | F5-C1–C3            |
| T23          | Mixed content format/JSON dönüşümü/önden kardeş ekleme diff        | Anlam değişimi saklanmaz; loss/matching politikası testli                                   | F5-D1–D4            |

## Fixture önceliği

İlk set: namespace'li ve namespace'siz `.csproj`, `pom.xml`, `.config`, `.resx`, JUnit, sentetik UBL benzeri belge ve mixed-content örneği. İkinci set: TRX, coverage XML, SOAP/WSDL, XLIFF. Sonraki set: XBRL, SVG, DocBook ve arşiv içi parçalar yalnız ilgili fazda.

Bu öncelik yasal zorunluluk veya pazar büyüklüğü iddiasına dayanmaz; namespace, attribute, tekrar, iç içe kayıt ve mixed content çeşitliliğine dayanır. Gerçek müşteri secret/verisi fixture olarak alınmaz. Her fixture için kaynak/lisans veya sentetik üretim açıklaması, byte hash'i, encoding ve beklenen sonuç kaydı tutulur.

## Property ve karşılaştırma testleri

- Namespace prefix'lerini URI değiştirmeden yeniden adlandırınca semantic seçim sonucu aynı kalır.
- Sonuç sayfalarının birleşimi aynı snapshot ve aynı derinlik/görünüm seçenekleriyle üretilen küçük-fixture sonucu ile aynıdır; tekrar/kayıp yoktur. `nodeId` tekildir; ancestor context tekrar eklenmez; text/element/comment/PI kardeş sırası `childIndex` ile korunur. Derinlikte atlanan çocuklar yalnız daha derin ayrı okumada gelir, devam cursor'ıyla gelmiş sayılmaz.
- Attribute sırası değişimi kimlik değiştirmez; mixed content çocuk sırası değişimi fark oluşturur.
- Literal arama arbitrary text'i sorgu dili olarak çalıştırmaz.
- Rastgele malformed girdide sonuç ya bütçeli hata ya beklenen geçerli belgedir; crash/hang yoktur. Fuzz denemelerinin süre, seed ve küçültülmüş regresyon örneği kaydedilir.
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

Her XML görev kaydı şu alanları içerecek: görev kimliği, durum, commit/artifact, test komutu, ortam, fixture kimlikleri, beklenen/gerçek sonuç, gerekiyorsa elapsed/peak RSS, kalan sınır ve inceleyen. Bu şablon XML için henüz doldurulmadı. Excel/file-core için doldurulmuş bulgu/test/fixture ve CI kayıtları [kapanış belgesinde](excel-hardening-uygulama.md) bulunur.
