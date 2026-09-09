# 018 — XPath sözleşmesi, kayıt projeksiyonu ve sayısal politika

Tarih: 2026-09-09. Durum: **kabul edildi, kodla kanıtlandı** (`packages/xml-mcp`,
223 test); platform kanıtı bekliyor. Kanıt
[XML F3 kapanış kaydında](../xml/xml-f3-kapanis.md).

[Karar 017](017-xml-dugum-modeli-ve-yanit-sayfasi.md) düğüm kimliğini, cursor
bağını ve bütçenin süreçler arası bölüşümünü sabitledi. Bu karar onun üstünde
F3'ün **tüketiciye görünen** sözleşmesini sabitliyor: sorgunun nasıl alındığı,
sonucun nasıl tiplendiği, kaydın nasıl seçildiği ve sayının hangi koşulla
sayıya çevrildiği. [Tool sözleşmesi](../xml/tool-sozlesmesi.md) bu noktaları
"F3'te karar verilecek" diye bırakmıştı.

## Neden ADR

Üç yeni tool, iki yeni hata kodu ve yeni bir cursor kolu ajanın gördüğü
yüzeydir; [karar 015](015-dosya-kaynagi-cekirdegi.md)'in kuralı gereği
tüketiciye görünen sözleşme değişikliği ADR alır. Ayrıca bu karar
[F3 faz belgesinin](../xml/fazlar/03-sorgu-ve-kayitlar.md) iki noktasını
düzeltiyor: o belge kod yazılmadan önce yazıldı ve iki varsayımı ölçümle
çürütüldü (K18-3, K18-6).

## K18-1 — Namespace bağı dizi olarak alınır

`namespaces: { prefix, uri }[]`, `maxNamespaceBindings` ile şemadan sınırlı.
`z.record` iki şeyi yapamıyor: eleman sayısını şemada sınırlamak ve prototype
anahtarlarını dışarıda tutmak. Dizi biçimi ayrıca `describe_document`'ın
`namespaces: NamespaceAlias[]` çıktısıyla doğrudan eşleşiyor — ajan alias
listesini alıp `alias` değerini `prefix` olarak geri veriyor.

Yinelenen prefix **sessizce son değere düşmüyor**: `invalid_argument`. Bir
ifadenin iki farklı URI'ye bağlı aynı prefix'le ne demek istediği belirsizdir ve
belirsizliği sessizce çözmek yasaktır.

## K18-2 — Sıra motorun verdiği sıradır ve testle sabitlenir

XPath 1.0 node-set sırasız bir kümedir, dolayısıyla motorun dizi sırası
kâğıt üstünde bir sözleşme değil. Ölçüm (M21) motorun union'ı, ters axis'i ve
tekrarlı union'ı **belge sırasında ve tekilleştirilmiş** döndürdüğünü gösterdi.

Karar: yeniden sıralama yazılmadı. Sıra `xpath.spec.ts` ve adversarial korpusla
sabitlendi ve `libxml2-wasm` **exact pinlenmiş** (`0.7.2`, caret yok) olduğu için
motor davranışı sessizce kayamaz. Kayarsa test kırılır.

Reddedilen alternatif: türetilmiş `nodeId` üzerinden kendimiz sıralamak. Adres
zaten türetildiği için ucuzdu, ama adreslenemeyen üyeleri (prolog düğümleri)
nereye koyacağımız yeni bir soru açıyordu ve motorun ölçülmüş davranışını
gizliyordu.

## K18-3 — Sorgu cursor'ı worker restart'ından sağ çıkar

F3 faz belgesi "worker termination sonrası eski cursor reddedilmeli" diyor. Bu
cümle karar 017'den **önceki** F0-06 modelinden (`e06-14`) mirastır ve
K17-2 ile çelişiyor. F3 karar 017'yi izliyor: cursor `stamp`'e bağlı, generation'a
değil. Reddedilen yalnız iki şey: byte değişti (`stale_cursor`), seçenek değişti
(`invalid_argument`).

Gerekçe üç parçalı:

- Pool tek worker tutuyor ve **herhangi** bir çağrının timeout'u worker'ı
  öldürüyor. Generation bağı, başka bir çağrının patolojik sorgusu yüzünden
  ajanın sayfalama oturumunu iptal ederdi — kendi hatası olmayan bir
  `invalid_cursor`.
- `select_xpath` devamı restart olmasa da ifadeyi yeniden değerlendiriyor, yani
  restart'ın marjinal maliyeti yalnız re-parse. Ölçüldü (M24): patolojik ifade
  2.088 ms'de `resource_limit` verip worker'ı öldürdü, öldürmeden **önce** alınan
  cursor 202 ms'de doğru sayfayı verdi, sonraki sayfa 11 ms sürdü.
- Devamın doğruluğu worker kimliğinden değil determinizmden geliyor: aynı
  byte'lar aynı DOM'a parse oluyor ve K18-2 sırayı testle sabitledi.

## K18-4 — Node-set üyesi sekiz düğüm türünü taşır, adres türetilemeyeni işaretler

`kindOf` F2'de üç sınıfta `unsupported_node_kind` atıyordu ve bu üçü `eval`'in
gerçekten döndürebildiği sınıflardı: `XmlAttribute`, `XmlDocumentNode`
(`eval("/")`) ve `XmlNamespaceDeclNode`. Üye modeli bu yüzden `element`,
`attribute`, `text`, `cdata`, `comment`, `pi`, `entityReference`, `namespace` ve
`document` ayırıyor.

Adres yukarı yürüyüşle türetiliyor. Ölçüm (M19) iki tuzağı gösterdi:

- Prolog'daki comment ve PI'ın `parent`'ı, kök elementin `parent`'ı gibi `null`.
  Yürüyüş bu ikisini şekle bakarak ayırt edemiyor, bu yüzden zincirin tepesinde
  `isSameNode(document.root)` kontrolü var; kök değilse üye
  `unaddressable: "prolog"` dönüyor. Bu, F2 kalan sınır 1'in aynısıdır.
- `namespace::*` üyesinin `content`'i çöp okuyor (`"lk"` gibi): struct
  yerleşiminde o offset'te okunacak bir alan yok. Bu yüzden namespace üyesinden
  **hiçbir alan okunmuyor** ve axis'in kendisi reddediliyor (K18-6).

Attribute üyesi sahibinin adresini + kendi genişletilmiş adını taşıyor.
`locate` bir attribute alırsa fırlatıyor: attribute'un `prev`'i çocuk listesini
değil attribute listesini geziyor ve anlamsız bir kardeş indeksi üretirdi.

## K18-5 — Derlenen ifadeyi biz dispose ederiz; ifade cache'i yok

`libxml2-wasm`'ın `eval`/`find`/`get` string overload'ları içeride bir `XmlXPath`
derliyor ve onu **yalnız başarı yolunda** dispose ediyor; `try/finally` yok.
Ölçüldü (M22): 50 başarısız `doc.eval("//zz:x")` çağrısından sonra `diag` `live`
1'den 51'e çıktı ve belge dispose edildikten sonra bile 50 kaldı. Kendi
`compile` + `finally dispose` desenimiz aynı hata yolunda hiç sızdırmıyor.

Karar: ürün kodu string overload'larını kullanmıyor. `XmlXPath.compile` bizde,
`dispose` `finally`'de. `get` ayrıca boş node-set'i `null` ile karıştırıyor
(F0-01), yani `eval` tek güvenli giriş.

İfade cache'i eklenmedi: F0-07 dispose sırasının güvenli olduğunu kanıtladı ama
ölçülmüş bir ihtiyaç yok ve cache yeni bir yaşam süresi yüzeyi demek.

## K18-6 — Tanı iki kaynaktan gelir ve desteklenmeyen ifade değerlendirilmeden reddedilir

Ölçüm (M27) motorun iki farklı davrandığını gösterdi: eval hatasında spesifik
(`Undefined namespace prefix: zz`, `Unregistered function: matches`), compile
hatasında sabit şablon ve **konum yok**. Bu yüzden prefix ve fonksiyon adı motor
mesajından, sentaks tanısı `xpath-lex.ts`'ten geliyor ve mesaj konum uydurmuyor:
"motor konum bildirmedi" diyor.

Daha önemlisi M28: motor, adımı hiç eşleşmeyen bir predicate'i **hiç
değerlendirmiyor**. `//nothing[matches(.,'x')]` bu yüzden hata değil boş node-set
dönüyordu; ajan XPath 2.0 fonksiyonu kullanıp "başarı" görüyordu. Bu yüzden
`refuseUnsupported` değerlendirmeden önce koşuyor: bilinen XPath 2.0+ fonksiyonu
ve `namespace` axis'i `query_not_supported` ile reddediliyor.

Bu bir **ret**, rewrite değil. `namespaceMode` yok, ifade hiçbir kod yolunda
değiştirilmiyor. Lexer yalnız inceliyor.

Boş node-set + belgede boş olmayan default namespace + ifadede prefixsiz name
test birleşimi yanıtta `diagnostics` olarak bildiriliyor. **Otomatik ikinci
sorgu koşulmuyor**; tanı yalnız bir cümledir.

## K18-7 — `numericMode` açık opt-in; integer'da sesli hata, kesirde sayaç

`numericMode: "off" | "binary64"`, varsayılan `"off"`. `"off"` iken
`sum/avg/min/max` istemek `invalid_argument` ve recovery açık opt-in'i
adlandırıyor; yalnız `count`, `countValues` ve `countDistinct` var.

Dönüşüm politikası XPath 1.0 sayısal lexical'idir
(`^-?(?:\d+(?:\.\d*)?|\.\d+)$`, XML whitespace trim edilir). Motor `strtod` ile
hoşgörülü olduğu için `number("1e400")` `Infinity` veriyor; **bizim politikamız
`1e400`'ü sayı saymıyor**, çünkü XPath 1.0'da exponent biçimi yok. Ayrım:

- Mantissa'yı aşan değer (`M > 2^53 · 5^f`) → `numeric_precision`, işi durduruyor.
  Fixture `1234567890123456789` bunu tetikliyor; motorun kendi `number()`'ı aynı
  metni `1234567890123456800` yapıyor.
- Tam temsil edilemeyen kesir (`5^f ∤ M`, örneğin `10.10`) → kabul ediliyor ve
  `rounded` sayacına yazılıyor. `binary64` seçmek tam bunu satın almaktır.

Reddedilen alternatif — **katı tam temsil**: `10.10` dahil her temsil
edilemeyen değeri reddetmek. Ölçüm değil aritmetik öldürdü: gerçek para
belgelerinin çoğu hata verirdi ve `sum` exact decimal gelene kadar kullanılamaz
olurdu. Reddedilen ikinci alternatif — **her şeye sayaç**: büyük integer'ı da
sayıp `exact: false` işaretlemek. Sessizce bozulmuş bir toplam tam olarak
fixture'ların yakalamak için kurulduğu şeydir.

`numeric_overflow` **ilan edilmedi**: tek bir lexical değer sonsuza taşamıyor,
çünkü o kadar hane mantissa testine `numeric_precision` olarak takılıyor.
Üretilemeyen kodu ilan etmek atlamaktan kötüdür (F1 kuralı).

## K18-8 — Sütun metni doğrudan text çocuklarıdır; çoklu eşleşme hücre durumudur

`value.from: "text"` elementin kendi text/CDATA çocuklarını birleştiriyor,
derine inmiyor; element çocuğu da varsa hücre `mixed: true` taşıyor. Böylece
`<d>a<b>x</b>c</d>` `"ac"` + `mixed` veriyor, sessizce `"axc"` olmuyor. Derin
metin (`string()` semantiği) hücrenin byte maliyetini derinlikle
sınırsızlaştırdığı için alınmadı; F5'e ait belgelenmiş sınır.

Çoklu eşleşmede varsayılan `onMultiple: "error"` **hücreyi** işaretliyor:
`{ status: "multiple", count }`, değer yok, satır ve sayfa dönmeye devam ediyor.
`"list"` sınırlı değer dizisi, `"first"` açık opt-in. Reddedilen alternatif:
çağrının tamamını `invalid_argument` yapmak — 5.000 satırlık bir dosyadaki tek
düzensiz kayıt tool'u hiçbir şey döndürmez hâle getirirdi.

Hücre dört durum ayırıyor: `present`, `empty` (değer var ve boş string),
`missing` (adres hiçbir şeyle eşleşmedi), `multiple`.

`itemAddress` iki alanlı — tekil `ancestors`, tekrarlanan `name` — böylece
sözleşmenin "yalnız son segmentte `all`" kuralı **şemada temsil ediliyor** ve
ortada `all` yazılamıyor; runtime reddine gerek kalmıyor.

Satırlar adres tekrar etmiyor: zarf `itemParentAddress` + `itemName`'i bir kez,
satır `occurrence` taşıyor. Ölçüldü (M23b): 60 seviyede satır başına 198 B ve
ebeveyn adresi 3.421 B ile bir kez gidiyor; `read_node`'un aynı derinlikteki
kayıt maliyeti F2-08'de 2.940 B/kayıttı.

## K18-9 — Kahan toplamı ve ASCII fold worker içinde yerel kalır

Worker `@sk-mcp/file-core`'u import edemiyor (K7) ve depo locale bağımlı
casing'i lint kuralıyla yasaklıyor. İki kural burada çarpışıyor: `caseSensitive:
false` bir fold istiyor, fold'un çekirdekteki hâline erişim yok.

Karar: `src/text.ts` çekirdeğin `asciiLower`'ının bir kopyasını tutuyor ve
`src/numeric.ts` Kahan telafisini yerel uyguluyor. `caseSensitive: false`
yalnız ASCII fold ediyor, şema bunu söylüyor ve `İSTANBUL`/`istanbul`
eşleşmemesi testle sabitlendi.

Bu teslimde `packages/file-core` **hiç değişmedi**; ortak bir metin/sayı
yardımcı modülü, gerçekten üçüncü bir tüketici çıktığında ayrı bir karardır.

Reddedilen alternatif: lint kuralını `eslint-disable` ile susturup
`toLowerCase()` kullanmak. Kural tam olarak Türkçe noktalı I için var; susturmak
sözleşmeyi locale'e bağlardı.

## Reddedilen alternatifler

**Cursor'ı generation'a bağlamak.** F3 faz belgesinin yazdığı yol. Karar 017'yi
kısmen geri alırdı, tek sunucuda iki cursor ömrü yaratırdı ve ölçülmüş bedeli
başka bir çağrının hatası yüzünden kaybedilen bir sayfalama oturumuydu (K18-3).

**Node-set'i kendimiz sıralamak.** M21 motorun zaten belge sırası verdiğini ve
tekilleştirdiğini gösterdi; kendi sıralamamız ölçülmüş davranışı gizler ve
adreslenemeyen üyeler için yeni bir soru açardı (K18-2).

**Sütun adresinde occurrence ile tekil seçim.** Çoklu eşleşmeyi imkânsız
kılardı, ama sözleşmenin "ilk değer sessiz seçilmez" kuralını şemaya
gömmek yerine ondan kaçmak olurdu (K18-8).

**`query_timeout` kodu.** Sözleşme zaten `resource_limit` diyor; F2'nin
"aynı durum için ikinci kod türetilmez" kuralı geçerli.

## Sürümler

| Paket               | Önce  | Sonra     | Sebep                                                                     |
| ------------------- | ----- | --------- | ------------------------------------------------------------------------- |
| `@sk-mcp/xml-mcp`   | 0.2.0 | **0.3.0** | Üç yeni tool, iki yeni hata kodu, yeni cursor kolu; kırıcı değişiklik yok |
| `@sk-mcp/file-core` | 0.2.0 | 0.2.0     | Hiç değişmedi                                                             |
| `@sk-mcp/excel-mcp` | 0.4.0 | 0.4.0     | Hiç değişmedi                                                             |

`libxml2-wasm` `0.7.2` exact pinli kalıyor. K18-2 sırayı motor davranışına
dayandırdığı için caret bu kararı da geçersiz kılar.
