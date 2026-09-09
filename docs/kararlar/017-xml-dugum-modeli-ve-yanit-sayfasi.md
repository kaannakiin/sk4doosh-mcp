# 017 — XML düğüm modeli, cursor bağı ve yanıt sayfası

Tarih: 2026-09-09. Durum: **kabul edildi, kodla kanıtlandı** (`packages/xml-mcp`,
124 test). Kanıt [XML F2 kapanış kaydında](../xml/xml-f2-kapanis.md).

[Karar 016](016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md) yanıt bütçesi kapısını
`file-core`'a koydu ve `xml-mcp`'yi ikinci tüketici yaptı. Bu karar, o kapının
üstünde XML'in **tüketiciye görünen** sözleşmesini sabitliyor: düğüm kimliği,
cursor'ın neye bağlandığı, bütçenin hangi süreçte uygulandığı ve hangi hata
kodunun ilan edildiği. [Tool sözleşmesi](../xml/tool-sozlesmesi.md) bu noktaları
"F2'de karar verilecek" diye bırakmıştı.

## Neden ADR

015'in kuralı: tüketiciye görünen sözleşme değişikliği ADR alır. Buradaki dört
karar da yayınlanan yüzeyi belirliyor — `nodeId`'nin biçimi bir istemcinin ağaç
kurma kodunu, cursor'ın bağı bir agent'ın devam stratejisini, hata birleşimi ise
hata işlemeyi bağlar. Bunları yalnız faz kapanışına yazmak, ileride sözleşmeyi
kodun içinden okumayı gerektirirdi.

## K17-1 — `nodeId` childIndex yoludur

Sözleşme `nodeId`'nin "snapshot içinde tekil" olmasını istiyordu ama biçimini
belirlemiyordu. Karar: **kök'ten itibaren 1 tabanlı `childIndex` segmentleri, bütün
çocuk türleri sayılarak** — `"1.3.2"`.

- `parentId` öntektir (`"1.3"`), `childIndex` son segmenttir. İkisi de **türetilir**,
  ayrıca saklanmaz ve birbirleriyle çelişemez.
- Tekillik **belge çapındadır**, yalnız görünüm içinde değil.

Reddedilen alternatif: görünüm içinde opaque ordinal (`n17`). Aynı belgeye farklı
`address` veya `maxDepth` ile yapılan iki çağrı **aynı ordinal'i farklı düğümlere**
verirdi; istemci iki sonucu birleştiremez ve bunu fark edemezdi. Sözleşmenin sayfa
birleştirme kuralı yalnız tek bir görünümün sayfalarını konuşuyordu, bu tuzağı
öngörmüyordu.

Maliyet: derinlik arttıkça id uzuyor. Ölçüldü ve kabul edildi; asıl byte maliyeti
id değil, kaydın taşıdığı canonical adrestir (K17-3).

## K17-2 — Cursor `stamp`'e bağlanır, worker generation'ına değil

`residency = ${generation}:${stamp}` ana süreçteki handle'ın kimliğidir ve **her
worker yeniden başlatmasında** ölür. Pool her timeout'ta yeniden başlıyor — başka
bir belgenin sebep olduğu timeout dahil. Cursor'ı ona bağlamak, ilgisiz bir yavaş
belgenin devam eden bir okumayı öldürmesi demekti.

Karar: cursor `f` alanı **`stamp`**'tir, yani `contentFingerprint`. Sözleşmenin
istediği zaten budur: _"Snapshot kimliği işlenen byte'lara bağlıdır"_ ve _"kaybolan
snapshot cursor'ı **yeni belgeye** uygulanmaz"_. Aynı byte'lar aynı DOM'a parse
oluyor ve preorder deterministik olduğu için konum yeniden üretilebilir; worker
yeniden başlarsa residency miss protokolü belgeyi yeniden parse ediyor. Restart bir
okumayı kaybettirmiyor, bir re-parse'a mal oluyor.

İçerik gerçekten değiştiğinde `stamp` değişiyor ve cursor `stale_cursor` alıyor —
aynı boyut ve geri konmuş mtime ile bile, çünkü fingerprint byte tabanlıdır.

Cursor ayrıca tool'a (`t`), scope'a (`s`), normalize edilmiş seçeneklerin hash'ine
(`o`) ve son kullanmaya (`x`) bağlıdır. Seçenek değişimi sessizce cursor'dan geri
yüklenmez; açık `invalid_argument` döner.

## K17-3 — Cursor imzasızdır

Sözleşme "sunucu taraflı token ya da bütünlüğü korunan token" seçimini F2'ye
bırakmıştı. Karar: **düz base64url JSON, HMAC yok.**

Gerekçe yetenek analizidir, kolaylık değil: cursor **yetki vermiyor**. Her devam
çağrısında `resolveSourcePath` yeniden koşuyor ve konum adres modeline karşı yeniden
doğrulanıyor. Uydurulmuş bir cursor ancak çağıranın zaten açık `address` ile
erişebileceği düğümlere ulaşır — yani sandbox'ın dışına değil, aynı belgenin başka
bir yerine. İmza, yönetilecek bir anahtar ekler ve erişilebilir hiçbir yeteneği
kapatmaz.

Bu karar, cursor bir gün **yetki taşırsa** (örneğin scope dışı okuma hakkı ya da
sunucu tarafında saklanan bir sorgu) geçersizleşir. O noktada bütünlük korumalı
token gerekir.

## K17-4 — Sayfa bütçesi ana süreçte uygulanır

Worker `@sk-mcp/file-core`'u import edemez ([K7](../xml/kararlar.md) lint sınırı),
yani `createPageBudget` orada çalışamaz. Bölüşüm:

- **Worker**: `maxNodes`, `maxDepth`, `maxChars` — sayısal parametreler olarak
  request'te gelir, çünkü `limits.ts` de import edilemez.
- **Ana süreç**: `createPageBudget` **yetkili** kapıdır; arkasında `guard`'ın
  `coreLimits.maxPayloadBytes` kapısı durur. Worker'ın gönderdiği _k_'ıncı kayıt
  reddedilirse sayfa _k−1_'de biter ve `nextCursor` _k_'yı gösterir.

Sıfırıncı kayıt sığmazsa `resource_limit` döner — boş sayfa dönmez. Bu, sözleşmenin
"bir sayfa en az bir öğe ilerletmeli veya açık `resource_limit` vermelidir" kuralının
uygulamasıdır ve `excel-mcp`'nin `read_sheet` precedent'iyle aynıdır.

Aramada bir ek kural var: byte bütçesi bir eşleşmeyi reddederse **o düğümün bütün
eşleşmeleri** sayfadan çıkarılır ve cursor o düğümü gösterir. Devam sayfası düğümü
baştan tarar; çıkarılmasalardı iki attribute'la eşleşen bir element sınırda
tekrarlanırdı.

Ölçülen maliyet [kapanış kaydındadır](../xml/xml-f2-kapanis.md): kayıt başına 188
byte (düz) ile 2.940 byte (120 seviye derin) arasında. Sayfa değerleri `varsayılan
50, en fazla 200` olarak **ölçümle doğrulandı**; byte kapısı yalnız derin belgelerde
önce bağlıyor.

## K17-5 — `unsupported_encoding` dar kapsamda ilan edildi

F1 kapanışının 2. sınırı bu kodu reddetmişti: libxml2 encoding ve well-formedness
hatalarını aynı istisnayla bildiriyor ve ayırmak motor-mesajı eşlemesi ister.
_"Üretilemeyen bir kodu ilan etmek atlamaktan kötüdür."_

F2-11 tabloyu değiştirdi. Prolog tarayıcısı XML 1.0 Appendix F autodetection'ı
uygulamak zorunda kaldı ve o alt küme **dört byte'tan deterministik olarak
belirleniyor**: UCS-4 BE/LE, 2143, 3412 (BOM'lu ve BOM'suz) ve EBCDIC. Motor
mesajına hiç dokunmadan üretilebilir.

Karar: `SkMcpXmlErrorCode` birleşimine **`unsupported_encoding` eklendi** ve
**yalnız prolog tarayıcısından** üretiliyor. Motor-mesajı eşlemesi kapsam dışıdır ve
öyle belgelenir. F1'in kuralı çiğnenmedi, uygulandı: kod tam olarak üretilebildiği
yerde var, üretilemediği yerde yok.

Bu aynı zamanda ölçülmüş bir açığı kapatıyor: eski tarayıcı bu ailelerin hepsinde
DOCTYPE'ı kaçırıyor ve belgeyi `doc.dtd` backstop'una bırakıyordu; M11 o noktada
internal entity'nin zaten genişlemiş olduğunu ölçmüştü.

## K17-6 — Worker protokolü op haritasından türetilir

Eski `WorkerReply`'nin üç `ok: true` varyantı tag'siz ayrılıyordu ve pool onları
`("facts" in reply ? … ) as ParsedFacts` ile çözüyordu. Üç kind'da bile cast
gerekiyordu; altı kind'da tip güvenliği kalmazdı.

Karar: tek bir `WorkerOps` haritası; `WorkerRequest`, `WorkerRequestBody`,
`WorkerReply` ve `WorkerResultOf` ondan **türetilir**. `pool.ask(body)` gövdenin
tipinden `B["kind"]` ile sonucu çıkarır. Worker tarafındaki switch `satisfies never`
ile exhaustive'dir.

Geriye kalan tek daraltma noktası `reply.kind === request.kind` kontrolünün
arkasındaki cast'tir; runtime kontrolü yapıldığı yerdedir ve tek yerdedir. Eski
üç dağınık cast yerine bir tane, korumalı.

Bu değişiklik `XmlWorkerPool`'un `parse`/`diagnose`/`release` metotlarını kaldırıp
`ask` ile değiştirdi. Paket `0.2.0`'a çıkıyor.

## Reddedilen alternatifler

- **Görünüm içi opaque `nodeId`.** K17-1'de ölçülen çakışma.
- **Cursor'ı `residency`'ye bağlamak.** İlgisiz bir timeout devam eden okumayı
  öldürürdü.
- **HMAC'li cursor.** Erişilebilir hiçbir yeteneği kapatmadan anahtar yönetimi
  ekler.
- **`createPageBudget`'ı worker'a taşımak.** `file-core` import'u K7'nin lint
  sınırını ve K6'nın "worker host yüzeyinden bağımsızdır" kararını çiğnerdi.
- **Bütçeyi yalnız worker'da uygulamak.** Ürün sayacı kapıyı devre dışı bırakamaz
  (karar 016); worker'ın tahmini tahmindir, kapı ana süreçtedir.
- **`unsupported_encoding`'i motor mesajından türetmek.** Kapsam dışı kaldı; dar
  ilan bunun yerine geçmiyor, onun ölçülebilir alt kümesini kapsıyor.
- **`pool.parse` gibi kolaylık metotlarını `ask`'ın yanında tutmak.** İki yol aynı
  şeyi yapardı ve `document.ts` zaten `ask` kullanıyor.
- **PI target'ını private `_nodePtr` üzerinden okumak.** `canonicalizeToString()`
  aynı bilgiyi public yüzeyden veriyor.
