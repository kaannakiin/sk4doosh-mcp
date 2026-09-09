# XML F3 kapanış kaydı

Durum: **yerel olarak tamamlandı, platform kanıtı bekliyor** (2026-09-09). F3-01–07 uygulandı ve yerel dört-filtre koşusu yeşil: 712 test. [README](README.md)'nin yönetim kuralı gereği **bu kayıt henüz `tamamlandı` değildir**: durum yalnızca platform CI koşusunun bağlantısıyla `tamamlandı` yapılabilir ve yerel geçiş kapı değildir. Platform kanıtı bölümü bu yüzden boş bırakıldı; koşu yeşile geçtiğinde koşu kimliği ve commit buraya yazılacak.

## Kabul edilen kapsam

`packages/xml-mcp` artık sözleşmenin yedi tool'unu sunuyor: F2'nin dördü ile birlikte `select_xpath`, `project_records` ve `aggregate_document`. Tipli XPath 1.0 sonuç zarfı, sekiz düğüm türünü kapsayan node-set üye modeli, ordinal cursor kolu, açık `numericMode`, dört durumlu hücre modeli ve grup sayaç semantiği bu teslimde. `describe_document`'ın `capabilities` haritasında `xpath`, `recordProjection` ve `aggregation` artık `true`.

Kapsam dışı kalanlar değişmedi: streaming, çoklu belge arama, tip çıkarımı, şema doğrulama, ZIP/gzip, XML↔JSON, formatlama, diff, yazma ve XSLT. Bunlar F4–F5'tedir. XPath 2.0/3.1 ve XQuery **desteklenmiyor ve desteklenirmiş gibi örneklenmiyor**; kullanıcı extension function veya resolver kaydedemiyor.

## Başlangıç durumu

| Ölçüm              | Önce | Sonra   |
| ------------------ | ---- | ------- |
| Test toplamı       | 613  | **712** |
| `xml-mcp`          | 124  | **223** |
| `xml-mcp` spec     | 15   | **23**  |
| `file-core`        | 133  | 133     |
| `excel-mcp`        | 354  | 354     |
| `file-core-native` | 2    | 2       |
| `xml-mcp` tool     | 4    | **7**   |

`file-core` ve `excel-mcp` satırları değişmedi çünkü **bu teslimde çekirdeğe hiçbir XML kavramı girmedi ve `packages/file-core` hiç değişmedi**. Sayısal toplama (Kahan telafisi) ve ASCII fold, `file-core`'da benzerleri olmasına rağmen `xml-mcp` içinde yerel kaldı; gerekçesi K18-9'dadır. `@sk-mcp/xml-mcp` `0.2.0 → 0.3.0`: yayınlanan hata birleşimine iki yeni kod girdi (`query_not_supported`, `numeric_precision`), üç tool ve bir cursor kolu eklendi; kırıcı değişiklik yok, bu yüzden minor.

## Görev bazında kapanış

### F3-01 — `select_xpath` şeması ve namespace haritası

| Alan          | Değer                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------- |
| Görev kimliği | F3-01                                                                                     |
| Durum         | uygulandı                                                                                 |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                                            |
| Ortam         | darwin arm64, Node v24.12.0                                                               |
| Fixture       | `pom.xml`, `wide.xml`, `wide-query.xml`                                                   |
| Beklenen      | Açık alias → URI, XPath 1.0 sınırı, ifade sessiz rewrite edilmez                          |
| Gerçek        | 4 lexer testi + 5 şema/bağ testi geçti (`xpath-diagnosis.spec.ts`, `query-tasks.spec.ts`) |

Namespace bağı `z.record` değil `{ prefix, uri }` dizisi (K18-1): record ne eleman sayısını şemadan sınırlayabiliyor ne de prototype anahtarlarını dışarıda tutuyor. Yinelenen prefix sessizce son değere düşmüyor, `invalid_argument` oluyor. `maxNamespaceBindings` ve `maxXpathChars` şema sınırı olduğu için gerçek MCP istemcisiyle reddedildikleri ayrıca test edildi — doğrudan handler çağrısı zod'u atlıyor, bu yüzden şema testleri stdio istemcisi üzerinden koşuyor.

`xpath-lex.ts` ifadeyi yalnız inceliyor: string literal'leri atlıyor, prefix / prefixsiz name test / fonksiyon / axis çıkarıyor. Hiçbir kod yolu ifadeyi değiştirmiyor.

### F3-02 — Motor evaluation, tipli sonuç zarfı ve adresleme

| Alan          | Değer                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Görev kimliği | F3-02                                                                                           |
| Durum         | uygulandı                                                                                       |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                                                  |
| Ortam         | darwin arm64, Node v24.12.0                                                                     |
| Fixture       | `pom.xml`, `simple.xml`, `mixed.xml`, `junit.xml`, `prolog-nodes.xml`, `deep.xml`, `wide.xml`   |
| Beklenen      | Node-set/string/number/boolean ayrı; boş node-set başarı; NaN/Infinity açık; disposable kapanır |
| Gerçek        | 14 test (`xpath.spec.ts`) + 6 test (`locate.spec.ts`) geçti                                     |

Dört `resultType` ayrı; boş node-set `members: []`, `totalMembers: 0`, `complete: true` ile **başarı**. Sayı için `numberKind` açık: `nan`, `positiveInfinity`, `negativeInfinity` için `value: null` ve `valueText` her zaman var, yani F0-03'ün "JSON zarfı NaN/Infinity'yi null'a çeviriyor" bulgusu artık sözleşmede karşılanıyor. `negativeZero` ayrı bir tür olarak taşınıyor çünkü `JSON.stringify(-0)` `0` yazıyor.

Adresleme yukarı yürüyüşle türetiliyor: `locate.ts`, `traverse.ts`'in `next` borrow desenini `prev` için tekrarlıyor ve `find("//node()")` yerine ileri yürüyüşün kayıtlarına karşı doğrulanıyor. Attribute üyesi sahibinin adresini + kendi genişletilmiş adını taşıyor; `locate` bir attribute alırsa **fırlatıyor**, çünkü attribute'un `prev`'i çocuk listesini değil attribute listesini geziyor ve anlamsız bir kardeş indeksi üretirdi.

### F3-03 — Maliyet, sayfa ve devam

| Alan          | Değer                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| Görev kimliği | F3-03                                                                                    |
| Durum         | uygulandı                                                                                |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                                           |
| Ortam         | darwin arm64, Node v24.12.0                                                              |
| Fixture       | `wide-query.xml` (300 kayıt), `heavy-query.xml` (45 seviye × 250 hücre)                  |
| Beklenen      | Süre bütçesi işi durdurur; byte kapısı sayfayı keser; cursor başka sorguyla kullanılamaz |
| Gerçek        | 11 test (`xpath-page.spec.ts`) geçti; M24 timeout ve devam maliyetini ölçtü              |

`maxResults` kesmesi ve byte kesmesi ayrı `truncationReason` veriyor; iki yolda da sayfaların birleşimi tam node-set'e eşit ve hiçbir üye iki kez dönmüyor (300 ve 250 üyeli iki senaryoda tekillik testli). İlk üye sığmazsa `resource_limit`.

Cursor `xpath` ve `records` kolları için **ordinal** taşıyor, yol değil. Yanlış tool, değişmiş ifade, değişmiş namespace bağı ve süresi geçmiş token ayrı ayrı reddediliyor.

### F3-04 — Hata tanıları

| Alan          | Değer                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Görev kimliği | F3-04                                                                       |
| Durum         | uygulandı                                                                   |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                              |
| Ortam         | darwin arm64, Node v24.12.0                                                 |
| Fixture       | `pom.xml`, `malformed.xml`, `doctype.xml`                                   |
| Beklenen      | Geçersiz prefix, unsupported XPath, default namespace tuzağı düzeltilebilir |
| Gerçek        | 13 test (`xpath-diagnosis.spec.ts`) + 30 ifadelik korpus geçti              |

Ölçüm sürpriziyle karşılaşan yer burası oldu (M27, M28): motor **eval** hatasında spesifik konuşuyor (`Undefined namespace prefix: zz`, `Unregistered function: matches`) ama **compile** hatasında sabit şablon veriyor ve konum bildirmiyor. Dolayısıyla prefix ve fonksiyon adı motor mesajından, sentaks tanısı ise bizim lexer'ımızdan geliyor; mesaj konum uydurmuyor, "motor konum bildirmedi" diyor.

Daha ciddi olan M28: motor, adımı hiç eşleşmeyen bir predicate'i **hiç değerlendirmiyor**. `//nothing[matches(.,'x')]` bu yüzden hata değil boş node-set dönüyordu ve ajan XPath 2.0 fonksiyonu kullanıp "başarı" görüyordu. Bu yüzden `refuseUnsupported` değerlendirme öncesinde koşuyor ve `query_not_supported` veriyor. Bu bir rewrite değil, bir ret: ifade hiç değiştirilmiyor.

Boş node-set + belgede boş olmayan default namespace + ifadede prefixsiz name test birleşimi, yanıtta `diagnostics` olarak bildiriliyor. **Otomatik ikinci sorgu koşulmuyor**; tanı yalnız bir cümle.

### F3-05 — `project_records`

| Alan          | Değer                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| Görev kimliği | F3-05                                                                                         |
| Durum         | uygulandı                                                                                     |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                                                |
| Ortam         | darwin arm64, Node v24.12.0                                                                   |
| Fixture       | `records.xml`, `wide-query.xml`, `pom.xml`, `junit.xml`                                       |
| Beklenen      | Tekrar kümesi ve sütun adresleri açık; missing/empty/multiple ayrı; sıra ve sayfalama kararlı |
| Gerçek        | 20 test (`records.spec.ts`) geçti                                                             |

`itemAddress` iki alanlı: tekil `ancestors` ve tekrarlanan `name`. Ortada `all` **temsil edilemiyor**, yani runtime reddine gerek kalmıyor — F2'nin regex'i şemadan çıkarma desenin aynısı.

Hücre dört durum taşıyor ve çoklu eşleşmede varsayılan hiçbir değer seçmiyor: `{ status: "multiple", count }`. `list` ve `first` açık opt-in. Doğrudan text çocukları okunuyor; element çocuğu da varsa hücre `mixed: true` taşıyor, yani iç içe markup sessizce düzleşmiyor.

Satırlar adres tekrar etmiyor: zarf `itemParentAddress` + `itemName`'i bir kez, satır ise `occurrence` taşıyor. M23b bunun ölçülmüş faydasını gösteriyor.

### F3-06 — `aggregate_document`

| Alan          | Değer                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| Görev kimliği | F3-06                                                                                         |
| Durum         | uygulandı                                                                                     |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                                                |
| Ortam         | darwin arm64, Node v24.12.0                                                                   |
| Fixture       | `amounts.xml`, `invoice.xml`                                                                  |
| Beklenen      | Önce count; numeric metrikler açık dönüşüm politikasıyla; grup limiti sayaç anlamını bozmuyor |
| Gerçek        | 16 test (`aggregate.spec.ts`) + 8 test (`numeric.spec.ts`) geçti                              |

`count` her zaman var ve kolon istemiyor. `sum/avg/min/max` yalnız `numericMode: "binary64"` ile açılıyor; aksi hâlde `invalid_argument` ve recovery açık opt-in'i adlandırıyor. Dönüşüm politikası XPath 1.0 sayısal lexical'idir: motor `strtod` ile hoşgörülü olduğu için `number("1e400")` `Infinity` verirken **bizim politikamız `1e400`'ü sayı saymıyor**. Mantissa'yı aşan değer (`1234567890123456789`) `numeric_precision` ile işi durduruyor; tam temsil edilemeyen kesir (`10.10`) kabul edilip `rounded` sayacına yazılıyor.

`numeric_overflow` **ilan edilmedi**: tek bir lexical değer sonsuza taşamıyor, çünkü o kadar hane mantissa testine `numeric_precision` olarak takılıyor; toplamın taşması için de gerçekçi bir yol yok. Üretilemeyen kodu ilan etmek atlamaktan kötüdür (F1 kuralı).

Grup sayaçları bozulmuyor: `groupCount` bütün taramanın farklı grup sayısı, `matchedItems` bütün eşleşen kayıt sayısı, `returnedMatchedItems` yalnız dönen grupları kapsıyor ve `hint` bunu söylüyor. Grup anahtarı çakışması uzunluk önekli kodlamayla engelleniyor; M29 bu kodlamanın bir yan etkisini yakaladı.

### F3-07 — Golden ajan görevleri ve adversarial korpus

| Alan          | Değer                                                      |
| ------------- | ---------------------------------------------------------- |
| Görev kimliği | F3-07                                                      |
| Durum         | uygulandı                                                  |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`             |
| Ortam         | darwin arm64, Node v24.12.0, gerçek stdio MCP istemcisi    |
| Fixture       | `junit.xml`, `pom.xml`, `invoice.xml` + 30 ifadelik korpus |
| Beklenen      | Sonuç beklenen fixture değerleriyle eşleşiyor              |
| Gerçek        | 6 test (`query-tasks.spec.ts`) geçti                       |

Üç görev gerçek `dist/cli.js` süreci ve gerçek MCP istemcisiyle koşuyor, yani şema doğrulaması da yolda. JUnit görevinde iki failure'ın mesajı ve stack'i birebir; pom görevinde `beta 2.3.4` dönüyor ve `t:` tuzak namespace'inin `9.9.9`'u yanıtta hiç yok; fatura görevinde satır sayısı 2 ve aynı belgeye `sum` istendiğinde `numeric_precision` dönüyor — yani ajan "toplam" isteyince sessiz bir yanlış sayı değil, sesli bir ret alıyor.

Adversarial korpus 30 ifade: her biri ya tipli bir sonuç ya adlandırılmış bir hata veriyor, hiçbiri `internal_error` değil ve hiçbir yanıt sandbox kökünü sızdırmıyor. Korpus `test/fixtures/manifest.ts` içinde veri olarak durduğu için F6 aynı listeyi tekrar koşabilir.

## Paket doğrulaması

`xml-mcp` ne `@sk-mcp/core`'a ne `packages/xml-lab`'e hiçbir yönde bağlı değil. **Worker sınırı bu teslimde bir kez gerçekten ihlal edildi ve mekanik test yakaladı**: `records.ts`'e case folding için `@sk-mcp/file-core`'dan `asciiLower` importu girdi, `policy.spec.ts`'in modül grafiği taraması worker girişinden ulaşılan bir host kenarı buldu. Lint bunu göremezdi çünkü lint yalnız worker girişinin doğrudan import'larını görüyor; kenar iki modül uzaktaydı. F2'nin "mekanik test lint'in yerine değil yanına kondu" kararı böylece kendi bedelini ödedi.

Worker modül grafiği 8 → **14 modül**: `xml-worker`, `aggregate`, `numeric`, `records`, `text`, `node-model`, `traverse`, `describe`, `namespaces`, `find`, `parse-policy`, `worker-protocol`, `xpath`, `locate` (`query-model` yalnız tip taşıdığı için derlenen grafikte yok) ve **`@sk-mcp/file-core`, `zod` veya MCP SDK'sına tek bir kenar yok**.

Parse bayrakları değişmedi: `HARDENED` hâlâ tam olarak üç bayrak, `XML_PARSE_NOBLANKS` ve `XML_PARSE_NOCDATA` kapalı.

## Platform kanıtı

| Alan          | Değer                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CI koşusu     | **alınmadı** — bu kaydı `tamamlandı` yapacak koşu budur                                                                                |
| XML F0 koşusu | **alınmadı**                                                                                                                           |
| Commit        | **yazılmadı**                                                                                                                          |
| Native matris | **koşulmadı**                                                                                                                          |
| Yerel koşu    | `pnpm turbo run test --filter=@sk-mcp/file-core-native --filter=@sk-mcp/file-core --filter=@sk-mcp/excel-mcp --filter=@sk-mcp/xml-mcp` |
| Yerel sonuç   | 712 test: `file-core-native` 2, `file-core` 133, `excel-mcp` 354, `xml-mcp` 223                                                        |
| Yerel kapılar | `pnpm check-types` 15/15, `pnpm lint` 14/14 (xml-mcp'de sıfır uyarı)                                                                   |

Bu tablo kasten eksiktir. Yerel koşu bir kapı değildir ve bu kayıt platform kanıtı gelene kadar `tamamlandı` sayılmaz.

## Ölçülen ve kararı değişen noktalar

| Bulgu                                                                                                                                                    | Sonuç                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **M19** — Prolog comment/PI'nın `parent`'ı kök elementin `parent`'ı gibi `null`; `namespace::*` üyesinin `content`'i çöp okuyor (`"lk"`)                 | Yukarı yürüyüş kök kimliğini `isSameNode` ile kontrol ediyor; namespace üyesinden hiçbir alan okunmuyor ve axis reddediliyor      |
| **M20** — 4.000 elementlik belgede 200 üyenin adresi 147 ms; üye başına 290 B (düz), 3.713 B (60 seviye) ve 60 seviyede byte kapısı 141 üyede bağlıyor   | Adres bütçesi **eklenmedi**: byte kapısı yürüyüş maliyetinden önce bağlıyor                                                       |
| **M21** — Motor union'ı, ters axis'i ve `//two \| //two`'yu belge sırasında ve tekilleştirmiş döndürüyor                                                 | Yeniden sıralama **yazılmadı**; sıra testle sabitlendi ve `libxml2-wasm` exact pinlenmiş olduğu için sessizce kayamaz             |
| **M22** — Başarısız her `doc.eval(string)` bir derlenmiş ifade sızdırıyor: 50 çağrıda `live` 1 → 51 ve belge dispose edilince 50 kalıyor                 | `XmlXPath.compile` + `finally dispose` zorunlu; `eval`/`find`/`get`'in string overload'ları ürün kodunda yasak                    |
| **M23** — Satır başına 194 B (4 sütun), grup başına 536 B (2 metrik) / 99 B (yalnız count)                                                               | `50 / 200` varsayılan ve tavan doğrulandı                                                                                         |
| **M23b** — 60 seviyede satır başına 198 B; ebeveyn adresi 3.421 B ile bir kez gönderiliyor                                                               | Satırın adres yerine `occurrence` taşıması, F2 kalan sınır 2'nin (derinlikle doğrusal 2.940 B/kayıt) kayıt tool'larında karşılığı |
| **M24** — Patolojik ifade 2.088 ms'de `resource_limit`, generation 0 → 1, 1 terminate; **öldürmeden önce alınan cursor** 202 ms'de doğru sayfayı veriyor | K18-3 ölçüldü: restart bir okumayı kaybettirmiyor, bir re-parse'a mal oluyor                                                      |
| **M25** — `numberKind` worker'da hesaplandığı için `postMessage`'ın `-0`/NaN davranışı sözleşmeyi hiç etkilemiyor                                        | Taşıma katmanı için ayrı bir önlem gerekmedi                                                                                      |
| **M26** — Motorun kendi XPath hata yazıcısı **stderr**'e yazıyor; stdout temiz kaldı                                                                     | stdio MCP akışı için ek önlem gerekmedi; `stdout.spec.ts` kapısı yeterli                                                          |
| **M27** — Motor eval hatasında prefix/fonksiyon adını veriyor, compile hatasında sabit şablon veriyor                                                    | Tanı iki kaynaktan: prefix/fonksiyon motordan, sentaks lexer'dan; konum uydurulmuyor                                              |
| **M28** — Motor, eşleşmeyen adımın predicate'ini hiç değerlendirmiyor, bu yüzden XPath 2.0 fonksiyonu boş node-set olarak "başarılı" dönüyordu           | `refuseUnsupported` değerlendirmeden önce koşuyor                                                                                 |
| **M29** — Grup anahtarının uzunluk önekli kodlaması sıralamayı da sürüklüyordu: `HUGE` `TRY`'den sonra geliyordu                                         | Sıralama anahtar hücrelerini karşılaştırıyor; kodlanmış dize yalnız map kimliği                                                   |

M19–M29 numaraları bu kayda aittir. M11 F1 kapanışının, M12–M18 F2 kapanışının numaralarıdır.

## Kalan sınırlar

1. **Platform kanıtı yok.** Bu kaydın en büyük sınırı budur: CI ve XML F0 koşuları alınmadı, native matris koşulmadı. Sahibi **F3**; koşu yeşile geçmeden durum `tamamlandı` yazılmaz.

2. **Sütun metni yalnız doğrudan text çocuklarını okuyor.** `<d>a<b>x</b>c</d>` `"ac"` ve `mixed: true` veriyor. XPath 1.0 `string()` semantiği (derin metin) hücrenin byte maliyetini derinlikle sınırsızlaştırdığı için alınmadı. Sahibi **F5**.

3. **`where` sayısal karşılaştırma yapmıyor.** Bütün operatörler metinsel; `10.50` ile `10.5` eşit değil. Sayısal filtre isteyen ajan XPath predicate'i kullanıyor. Sahibi **F5**.

4. **Exact decimal aggregate yok.** `numericMode` yalnız `binary64`; tam ondalık toplama için ayrı bir sayı temsili ve ayrı bir dönüşüm politikası gerekir. Sahibi **F5**.

5. **`caseSensitive: false` yalnız ASCII fold ediyor.** `İSTANBUL` ile `istanbul` eşleşmiyor. Worker `file-core`'un unicode yardımcılarını import edemiyor (K7) ve depo locale bağımlı casing'i yasaklıyor; ASCII fold ikisini de karşılayan tek seçenekti ve şema bunu söylüyor. Testle sabitlendi. Sahibi **F5**.

6. **Namespace ve prolog düğümleri adreslenemiyor.** `namespace` axis'i reddediliyor (M19), prolog comment/PI'ı `unaddressable: "prolog"` dönüyor. İkincisi F2 kalan sınır 1'in aynısı. Sahibi **F5**.

7. **`entityReference` ve `namespace` üye kolları üretilemiyor.** DOCTYPE reddedildiği için entity üretilemiyor, namespace axis'i reddedildiği için o kol da erişilemez; ikisi de savunma amaçlı duruyor. F2'nin `kindOf` içindeki aynı savunmasının devamı. Sahibi yok, belgelenmiş durum.

8. **Devam sayfası sorguyu yeniden değerlendiriyor.** Sözleşme bunu zaten söylüyor; hızlı devam garantisi verilmiyor. `wide.xml` üzerinde ikinci sayfa 11 ms, re-parse gerekince 202 ms. Sahibi yok, ölçülmüş davranış.

9. **`file-core` 1.0 kararı verilmedi.** Değişmedi; karar **F6-08**'dedir.

## Sonraki faza devir

| Nerede                               | Ne                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| [F3](fazlar/03-sorgu-ve-kayitlar.md) | Platform CI ve XML F0 koşusu (kalan sınır 1); koşu yeşile geçince bu kaydın durum satırı ve platform tablosu doldurulur                |
| [F4](fazlar/04-buyuk-dosya.md)       | Derin belgelerde `read_node` kayıt byte'ının düşürülmesi; F3 satırlarda `occurrence` ile ölçülmüş yolu gösterdi (M23b)                 |
| [F5](fazlar/05-genisletmeler.md)     | Derin metin sütunu (kalan sınır 2), sayısal `where` (3), exact decimal aggregate (4), unicode fold (5), namespace/prolog adresleme (6) |
| [F6](fazlar/06-yayin-ve-kabul.md)    | Yedi tool'un gerçek istemci testleri, adversarial korpusun tekrarı, `file-core` 1.0 kararı (kalan sınır 9), yayın sırası               |
