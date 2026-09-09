# XML F2 kapanış kaydı

Durum: **tamamlandı** (2026-09-09). F2-04–12 kapandı; F2-01/02/03 F1 kapanışında
kapanmıştı. Platform kanıtı alındı: [CI koşusu 34349535283](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34349535283)
**13/13 job yeşil** ve [XML F0 koşusu 34349535299](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34349535299)
**10/10 ayak yeşil**, commit `a088abd`. [README](README.md)'nin yönetim kuralının
istediği koşu budur; yerel geçiş kapı değildir.

## Kabul edilen kapsam

`packages/xml-mcp` artık sözleşmenin dört tool'unu da sunuyor: `list_documents`,
`describe_document`, `read_node`, `find_in_document`. Genişletilmiş ad/adres modeli,
sıralı düğüm görünümü, cursor sözleşmesi, sayfa bütçesi, eşzamanlı DOM bellek
katsayısı, kalan encoding aileleri ve eşzamanlı listeleme sınırı bu teslimde.

Kapsam dışı kalanlar değişmedi: XPath, regex, streaming, tip çıkarımı, şema
doğrulama, ZIP/gzip, XML↔JSON, formatlama, diff, yazma ve XSLT. Bunlar F3–F5'tedir.

## Başlangıç durumu

| Ölçüm              | Önce | Sonra   |
| ------------------ | ---- | ------- |
| Test toplamı       | 529  | **613** |
| `xml-mcp`          | 40   | **124** |
| `xml-mcp` spec     | 6    | **15**  |
| `file-core`        | 133  | 133     |
| `excel-mcp`        | 354  | 354     |
| `file-core-native` | 2    | 2       |
| `xml-mcp` tool     | 1    | **4**   |

`file-core` ve `excel-mcp` sayıları değişmedi: **bu teslimde çekirdeğe hiçbir XML
kavramı girmedi** ve `packages/file-core` hiç değişmedi. `@sk-mcp/xml-mcp` sürümü
`0.1.0 → 0.2.0` olur; yayınlanan hata birleşimine yeni bir kod girdiği ve
`createXmlMcpServer` yeni bir seçenek aldığı için minor.

## Görev bazında kapanış

### F2-04 — genişletilmiş ad, adres ve sıralı düğüm modeli

| Alan          | Değer                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Görev kimliği | F2-04                                                                       |
| Durum         | tamamlandı                                                                  |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                              |
| Ortam         | darwin arm64, Node v24.12.0                                                 |
| Fixture       | `mixed`, `namespaceTraps`, `deep`, `wide`, `invoice`                        |
| Beklenen      | Aynı URI+localName tek kimlik; whitespace ve mixed-content sırası korunuyor |
| Gerçek        | 22 test (`traverse.spec.ts` 12, `namespaces.spec.ts` 10) geçti              |

Yeni modüller: `node-model.ts` (adres/kayıt tipleri), `traverse.ts` (düğüm türü
ayrımı ve preorder yürüteci), `namespaces.ts` (in-scope bağ toplama ve alias).

**Ölçülen sessiz veri kaybı ve düzeltmesi.** Planın öngördüğü düz
`firstChild` → `next` yürüyüşü ilk processing instruction'da **hatasız duruyor**:

| Yöntem                       | `<root>t1<?pi-a?><![CDATA[cd]]><!--c--><?pi-b?><child/> tail </root>` |
| ---------------------------- | --------------------------------------------------------------------- |
| `n = n.next`                 | 7 çocuktan **2**'si — beşi sessizce kayıp                             |
| Ödünç alınan `next` getter'ı | 7 çocuğun hepsi, doğru sırada                                         |
| `root.find("node()")`        | 7 çocuğun hepsi, aynı sıra                                            |

Sebep: `XmlProcessingInstructionNode` `XmlNode`'u genişletiyor, `XmlTreeNode`'u
değil; `next` o prototipte tanımlı olmadığı için `undefined` dönüyor ve döngü
istisna atmadan sonlanıyor. Çözüm `traverse.ts`'teki tek `nextSibling()`
yardımcısıdır: `XmlTreeNode.prototype`'ın `next` getter'ını descriptor'dan alıp
`call` eder. `find("node()")` **production yolu değil, testte oracle**'dır; iki
yürüyüş altı düğüm türünü birden içeren fixture'da karşılaştırılır.

Düğüm türü ayrımı tek `kindOf()` fonksiyonundadır: motor `nodeType` vermiyor,
ayrım `instanceof`'tur ve `XmlText`/`XmlComment`/`XmlCData` yapısal olarak aynı boş
alt sınıflar olduğu için **`XmlSimpleNode` ile test etmek yasaktır**. Kazanç:
`XmlCData` ayrı sınıf olduğu için `kind: "cdata"` gerçek bir değer taşıyor;
sözleşme yalnız "metin anlamı korunur" diyordu.

`XmlProcessingInstructionNode` paket kökünden export edilmediği için deep import
(`libxml2-wasm/lib/nodes.mjs`) kullanılıyor; paketin `exports` haritası yok, sürüm
`0.7.2`'ye exact pinli ve erişilebilirlik mekanik testle sabitlendi.

PI target'ı public yüzeyde yok — `content` yalnız target'tan sonrasını veriyor.
Ölçüldü ki `XmlNode.canonicalizeToString()` PI'da `<?tgt a="1"?>` üretiyor; target
oradan türetiliyor, **private pointer'a dokunulmadan**.

`element.content` özyinelemeli birleştirilmiş metin döndürdüğü için sıralı
görünümde **hiç okunmuyor**; okunsaydı sözleşmenin açıkça reddettiği "alt element
sınırlarını geçen birleştirilmiş metin" sessizce üretilirdi. Test bunu sabitliyor.

### F2-05 — yapı keşfi

| Alan          | Değer                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Görev kimliği | F2-05                                                                       |
| Durum         | tamamlandı                                                                  |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                              |
| Beklenen      | Root, alias'lar, örnek adres, yetenek/sınır, kısmi yapı; şema garantisi yok |
| Gerçek        | 9 test (`describe.spec.ts`) geçti                                           |

`describe_document` root genişletilmiş adını, her namespace için kararlı alias'ı,
bütçeli yapı sayılarını, tekrar adaylarını, mixed-content örneklerini ve
`read_node`'un **değiştirmeden kabul ettiği** bir örnek adresi döndürüyor. Örnek
adresin gerçekten çalıştığı round-trip testiyle kanıtlandı.

Alias üretimi deterministik: URI'ler preorder ilk görülme sırasında geziliyor,
bildirilen prefix çakışmıyorsa korunuyor, aksi halde `ns1`, `ns2`, … Boş olmayan
default namespace **her zaman** sentetik alias alıyor, çünkü XPath 1.0 onu boş
prefix'le adresleyemez (K3).

Encoding'de yalnız declaration raporlanıyor; `detectedEncoding` **uydurulmuyor** ve
alan yanıtta hiç yok. Sayılar örneklemden geldiyse `elementCountExact` ve
`namespacesComplete` `false` oluyor.

### F2-06 — bütçeli düğüm okuma

| Alan          | Değer                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| Görev kimliği | F2-06                                                                      |
| Durum         | tamamlandı                                                                 |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                             |
| Fixture       | `wide`, `deep`, `invoice`, `heavyPages`, `oversizedNode`, `swap.xml`       |
| Beklenen      | Derinlik/node/byte sınırı birlikte; cursor ilerliyor; kaynak değişimi hata |
| Gerçek        | 18 test (`read-node.spec.ts` 11, `cursor.spec.ts` 7) geçti                 |

**Sayfa birleştirme kapısı geçti.** Aynı snapshot ve seçeneklerle 7'şerlik
sayfaların birleşimi, tek sayfalık sonucun **birebir aynısı**; `nodeId` tekrarı
sıfır, kayıp sıfır. `maxNodes: 1` ile her sayfa en az bir kayıt ilerletiyor.

`nodeId` **childIndex yoludur** (`"1.3.2"`): kök'ten itibaren 1 tabanlı, bütün
çocuk türleri sayılarak. `parentId` önektir, `childIndex` son segmenttir; ikisi de
türetilir. Tekillik **belge çapındadır**, yalnız görünüm içinde değil — görünüm-içi
ordinal farklı `address`/`maxDepth` ile yapılan iki çağrıda çakışır ve istemci iki
sonucu birleştiremezdi. Gerekçe [karar 017](../kararlar/017-xml-dugum-modeli-ve-yanit-sayfasi.md).

Ancestor `context` yalnız devam sayfasında geliyor, `returnedCount`'a katılmıyor ve
birleştirmede tekrar eklenmiyor. Testle sabitlendi.

`maxDepth` sınırındaki element `childrenOmitted: true` alıyor ve **`nextCursor`
üretilmiyor** — atlanan çocuklar cursor'ın vaadi değil; o elementin canonical
adresiyle ayrı çağrı gerekiyor. Kabul fixture'ı üçünü birlikte sınıyor.

Cursor `stamp`'e bağlanıyor, `residency`'ye değil. `residency` her worker yeniden
başlatmasında ölürdü ve pool **her timeout'ta** yeniden başlıyor — başka bir belgenin
sebep olduğu timeout dahil. `stamp` içerik kimliğidir; yeniden başlatmadan sonra aynı
byte'lar aynı DOM'a parse oluyor ve preorder deterministik olduğu için konum yeniden
üretilebiliyor. Restart bir okumayı kaybettirmiyor, bir re-parse'a mal oluyor.

Token biçimi **imzasız base64url JSON**. Sözleşme bu seçimi F2'ye bırakmıştı. Cursor
yetki vermiyor: her devam çağrısında `resolveSourcePath` yeniden koşuyor ve konum
adres modeline karşı yeniden doğrulanıyor, yani uydurulmuş bir cursor ancak çağıranın
zaten açık `address` ile erişebileceği düğümlere ulaşır. HMAC yönetilecek bir anahtar
ekler, erişilebilir hiçbir yetenek eklemez.

**T12 geçti**: aynı boyutta içerik değişimi ve `utimes` ile geri konmuş mtime sonrası
eski cursor `stale_cursor` alıyor — `contentFingerprint` byte tabanlı olduğu için.

### F2-07 — literal arama

| Alan          | Değer                                                                           |
| ------------- | ------------------------------------------------------------------------------- |
| Görev kimliği | F2-07                                                                           |
| Durum         | tamamlandı                                                                      |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                                  |
| Beklenen      | Exact/contains, text/attribute/scope doğru; regex yok; kesik taramada total yok |
| Gerçek        | 12 test (`find.spec.ts`) geçti                                                  |

Regex **şemada hiç yok**: `matchMode` enum'u yalnız `contains` ve `exact` taşıyor,
yani runtime reddine gerek kalmıyor. Boş sorgu `z.string().min(1)` ile reddediliyor.
`v.*` sorgusu sıfır eşleşme veriyor — sorgu desen olarak çalıştırılmıyor.

Tam taramada `totalMatches`, erken durmada `scannedCount` + `matchedSoFar` dönüyor;
ikisi aynı yanıtta bulunmuyor. `searchIn: both` aynı elementin text ve attribute
eşleşmelerini farklı `matchKind` ile veriyor.

**Byte bütçesi bir eşleşmeyi reddederse o düğümün bütün eşleşmeleri sayfadan
çıkarılıyor** ve cursor o düğümü gösteriyor. Bir element iki attribute'uyla eşleşip
sınıra denk gelirse devam sayfası onları tekrarlardı; bu davranış testle sabitlendi.

### F2-08 — bütün MCP yanıtlarının doğrulanması ve sayfa bütçesinin ölçümü

| Alan          | Değer                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Görev kimliği | F2-08                                                                       |
| Durum         | tamamlandı                                                                  |
| Ölçüm aracı   | `packages/xml-mcp/test/fixtures/measure-pages.mjs`                          |
| Ortam         | darwin arm64, Node v24.12.0                                                 |
| Beklenen      | Hata dahil limit üstü yanıt yok; ham yol/stack yok; false/0/boş kaybolmuyor |
| Gerçek        | Ölçüldü; dört tool birlikte 512 KiB kapısının altında                       |

**Ölçülen sayfa maliyeti** (1 MiB kaynak, `maxNodes: 200`):

| Şekil                      | Dönen kayıt | Yanıt byte'ı | Kayıt başına | Duran sınır  |
| -------------------------- | ----------- | ------------ | ------------ | ------------ |
| Düz                        | 200         | 37.548       | 188          | `maxNodes`   |
| Attribute-yoğun (8 × 40)   | 200         | 123.854      | 619          | `maxNodes`   |
| Metin-yoğun (400 karakter) | 200         | 77.049       | 385          | `maxNodes`   |
| Derin (120 seviye)         | 102         | 299.874      | **2.940**    | byte bütçesi |

`find_in_document` 200 eşleşmede 34.916 byte (eşleşme başına ~175);
`describe_document` 1.037–1.274 byte; `list_documents` 501 byte.

**Karar: `Sayfa` satırı `varsayılan 50, en fazla 200` olarak doğrulandı.** Byte
bütçesi yalnız derin belgelerde önce bağlıyor ve bağladığında doğru çalışıyor:
sayfa kesiliyor, `truncationReason: "maxPayloadBytes"` dönüyor ve cursor
reddedilen kaydı gösteriyor.

**Ölçülen sınır: kayıt maliyeti derinlikle doğrusal büyüyor.** Her element kaydı
canonical adresini taşıyor, adres ise her ata için bir segment; 120 seviyede kayıt
başına 2.940 byte oluyor. `maxDomDepth` 128'de 200 kayıt teorik olarak zarfı aşar,
bu yüzden byte kapısı derin belgelerde `maxNodes`'tan önce devreye giriyor. Bu
kabul edilen bir maliyettir: sözleşme element kaydının canonical adres taşımasını
şart koşuyor.

İlk kayıt sığmazsa `resource_limit` dönüyor (4.000 attribute'lu tek element ile
sınandı) — boş sayfa dönmüyor. Hata yanıtları da zarfın altında; ham kök yolu ve
stack trace yanıtta yok.

### F2-09 — bağlantı testleri ve agent walkthrough

| Alan          | Değer                                                           |
| ------------- | --------------------------------------------------------------- |
| Görev kimliği | F2-09                                                           |
| Durum         | tamamlandı                                                      |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                  |
| Ortam         | Gerçek MCP istemcisi, `StdioClientTransport` → `dist/cli.js`    |
| Fixture       | `test/fixtures/manifest.ts` (beklenen değerler önceden yazıldı) |
| Gerçek        | 8 test (`agent-scenarios.spec.ts`) geçti                        |

Beş senaryonun hepsi gerçek stdio MCP istemcisi üzerinden, LLM olmadan, determinist
olarak koşuyor:

| Senaryo                 | Beklenen                                      | Sonuç                                                   |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `pom.xml` bağımlılığı   | `2.3.4`; `urn:trap` tuzağı seçilmemeli        | Doğru; yanıtta `9.9.9` hiç yok                          |
| Sentetik fatura         | `007`, `0080`, `10.50`, büyük tamsayı         | Hepsi string olarak korundu                             |
| Legacy `.csproj`        | `net48`, namespace'li adresle                 | Doğru                                                   |
| Namespace'siz `.csproj` | `net9.0`; legacy'ye uygulanmamalı             | Doğru; namespace'siz adres legacy'de `invalid_argument` |
| Mixed content           | Sıra ve whitespace korunmalı                  | Sekiz parça birebir sırayla döndü                       |
| Malformed belge         | Yapılandırılmış hata + sonraki çağrı sağlıklı | `malformed_xml` + recovery; sonraki çağrı çalıştı       |

**Dosya değişmediği mekanik olarak kanıtlandı**: bütün fixture'ların sha256'sı ve
mtime'ı senaryolardan önce ve sonra karşılaştırıldı, fark yok.

Çağrı sayısı manifestteki bütçenin altında kaldı. Üç çağrı bir kullanılabilirlik
hedefidir, doğruluk ölçütü değildir.

### F2-10 — eşzamanlı DOM bellek bütçesi ve yapılandırılabilir cache boyutu

| Alan          | Değer                                                                           |
| ------------- | ------------------------------------------------------------------------------- |
| Görev kimliği | F2-10                                                                           |
| Durum         | tamamlandı                                                                      |
| Probe         | `packages/xml-lab/test/probes/residency.mjs` (+ `residency-arm.mjs`)            |
| Komut         | `SKMCP_XML_BENCH=1 node --expose-gc packages/xml-lab/test/probes/residency.mjs` |
| Ortam         | darwin arm64, Node v24.12.0                                                     |
| Kararlılık    | Relative MAD ≤ 0,15; ölçülen 0,0016–0,0031                                      |

**Ölçülen şişme katsayısı** (1 MiB kaynak, kalıcı belge başına marjinal RSS):

| Şekil           | Marjinal RSS | Katsayı    | Relative MAD  |
| --------------- | ------------ | ---------- | ------------- |
| Düz             | 10.436.608   | **9,95×**  | 0,0008–0,0031 |
| Attribute-yoğun | 10.592.256   | **10,08×** | 0,0016–0,0047 |
| Derin (120)     | 9.674.752    | **9,25×**  | 0,0017–0,0025 |

**Türetilen bütçe.** En kötü şekil 10,08×. 8 MiB'lık dosya tavanında kalıcı belge
başına ≈ **81 MiB**. `documentCacheSize` S=4'te store'un pinleyebileceği ≈ **323
MiB**; worker kapasitesi W=2S=8 olduğu için worker tarafındaki en kötü hâl ≈ **645
MiB**. Bu sayı knob'un neden küçük kaldığını açıklıyor.

`documentCacheSize` **tek knob** olarak `createXmlMcpServer` seçeneğine girdi;
worker kapasitesi `workerCapacityFor(S) = 2S` ile türetiliyor. `W ≥ 2S−1`
invaryantı S ∈ {1, 2, 4, 8, 32, 64} için testle sabitlendi. **Default S=4 ve
W=8 değişmedi**, yani bugünkü davranış birebir korundu.

**Knob bir bütçedir, yaptırım değildir.** K5 gereği `worker.resourceLimits` JS
heap'ini bağlıyor, WASM linear memory'yi değil; bütçeyi aşmak temiz bir
`resource_limit` değil süreç ölümüdür. Kesin izolasyon isteyen dağıtımda OS ya da
container sınırı ayrıca gerekir.

**Ölçüm yöntemi iki kez düzeltildi ve ikisi de kayda değer.** İlk deneme toplu
before/after RSS okudu ve **her şekilde 0** verdi: linear memory işletim sistemine
geri verilmiyor ve süreç bir kez büyüdükten sonra sonraki belgeler mevcut boşluğa
yerleşiyor. F0-07 aynı sonucu kaydetmişti — _"tier-2 istatistiksel katman 220
belgelik kasıtlı bir leak'i hiçbir ayakta yakalayamadı"_. İkinci deneme **marjinal**
maliyeti ölçtü (ikinci ve sonraki belgeler; ilki tek seferlik arena büyümesini de
ödüyor) ve düz şekilde 9,9× verdi, ama attribute ve derin şekiller aynı süreçte
koştuğu için yine 0 okudu. Nihai tasarım **her şekli kendi sürecinde** ölçüyor;
`security-arm.mjs`'nin izole-arm deseninin aynısı.

Disposal oracle'ı iki taraflı: `diag` yalnız bu faz için açılıyor (F1: %24,9
maliyet), 5 belge tutulurken `live` 5 ölçülüyor, dispose'tan sonra 0. Tek taraflı
kontrol ölçmeden geçerdi — `diag` dispose'ta girdiyi siliyor.

### F2-11 — prolog tarayıcısının kalan encoding aileleri

| Alan          | Değer                                                               |
| ------------- | ------------------------------------------------------------------- |
| Görev kimliği | F2-11                                                               |
| Durum         | tamamlandı                                                          |
| Test komutu   | `pnpm turbo run test --filter=@sk-mcp/xml-mcp`                      |
| Fixture       | `utf32leDoctype`, `utf32beDoctype`, `utf32leClean`, `ebcdicDoctype` |
| Gerçek        | 9 test (`encoding.spec.ts`) geçti                                   |

**Ölçülen açık.** Eski prolog tarayıcısı, DOCTYPE'ı UTF-8 kontrolünde doğru
yakalarken bu ailelerin hepsinde **kaçırıyordu**:

| Girdi             | BOM tespiti | Eski tarayıcı DOCTYPE buldu mu? |
| ----------------- | ----------- | ------------------------------- |
| UTF-32LE + BOM    | `utf-32le`  | **hayır**                       |
| UTF-32BE, BOM'suz | yok         | **hayır**                       |
| UTF-32LE, BOM'suz | yok         | **hayır**                       |
| EBCDIC prolog     | yok         | **hayır**                       |
| UTF-8 (kontrol)   | yok         | evet                            |

Sebep `detectByteOrderMark` değil — o `utf-32le`'yi doğru adlandırıyor.
`decodeProlog`'un o markın **bir dalı yoktu**; UTF-8 okumasına düşüyor, ilk karakter
`<` çıkmıyor ve tarayıcı "DOCTYPE yok" diyordu. Belge böylece `doc.dtd`
backstop'una kalıyordu; M11 o noktada internal entity'nin **zaten genişlemiş**
olduğunu ölçmüştü. F2-11'in kabul ölçütü bunu açıkça yasaklıyor.

Çözüm XML 1.0 Appendix F autodetection'ı: dokuz dört-byte imzası (UCS-4 BE/LE,
2143, 3412 — BOM'lu ve BOM'suz — ve EBCDIC) **BOM kontrolünden önce** taranıyor ve
aile reddediliyor.

**`unsupported_encoding` ilan edildi.** F1 sınırı #2 bunu reddetmişti çünkü motor
mesajı eşlemesi gerekiyordu. Bu teslimdeki kod **yalnız prolog tarayıcısından**
üretiliyor: dört byte'tan deterministik olarak belirlenen aileler. Motor-mesajı
eşlemesi hâlâ kapsam dışı ve öyle kalıyor. F1'in kuralı — _"üretilemeyen bir kodu
ilan etmek atlamaktan kötüdür"_ — çiğnenmedi, uygulandı: kod tam olarak
üretilebildiği yerde var.

### F2-12 — eşzamanlı listeleme bütçesi

| Alan          | Değer                                                           |
| ------------- | --------------------------------------------------------------- |
| Görev kimliği | F2-12 (yeni; F1 kapanışının sahipsiz kalan tek sınırı)          |
| Durum         | tamamlandı                                                      |
| Beklenen      | Eşzamanlı listeleme sayısı sınırlı; aşımda yapılandırılmış hata |

F1 kapanışının 5. sınırı _"eşzamanlı listeleme sayısı sınırsız"_ sahipsizdi. Commit
`0e39a57`'nin koyduğu kural açık: **sahipsiz bulgu kaybolan bulgudur.** `list_documents`
artık `createGate` sayacından geçiyor; varsayılan 4 eşzamanlı listeleme,
`createXmlMcpServer`'ın `maxConcurrentListings` seçeneğiyle değiştirilebiliyor,
aşımda `resource_limit` dönüyor. Kuyruk yok: listelemenin kendi 1 saniyelik bütçesi
zaten var, beklemek yerine reddetmek doğru cevap.

## Paket doğrulaması

`packages/xml-mcp` `@sk-mcp/core`'a bağlı değil ve `packages/xml-lab`'ı hiçbir yönde
import etmiyor; xml-lab de xml-mcp'yi import etmiyor — F2-10 probe'u `libxml2-wasm`'ı
doğrudan kullanıyor, çünkü ölçülen şey motor özelliğidir, ürün özelliği değil.

**Worker sınırı mekanik testle korunuyor.** `dist/xml-worker.js`'in modül grafiği
taranıyor: 8 modül (`xml-worker`, `describe`, `node-model`, `namespaces`, `traverse`,
`find`, `parse-policy`, `worker-protocol`) ve **`@sk-mcp/file-core`, `zod` veya MCP
SDK'sına tek bir kenar yok**. Lint deny-list'i yalnız worker girişinin doğrudan
import'larını görüyor; yeni bir ara modül onu sessizce aşabilirdi, bu yüzden mekanik
test lint'in yerine değil **yanına** kondu.

Parse bayrakları da testle sabitlendi: `HARDENED` tam olarak üç bayrak, ve
`XML_PARSE_NOBLANKS` ile `XML_PARSE_NOCDATA` **kapalı**. İkisi de "performans için"
eklenmeye makul görünür; açılsalardı whitespace text node'ları ve CDATA ayrımı
sessizce kaybolurdu.

## Platform kanıtı

| Alan          | Değer                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CI koşusu     | [34349535283](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34349535283) — **13/13 job**                                     |
| XML F0 koşusu | [34349535299](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34349535299) — **10/10 ayak**                                    |
| Commit        | `a088abd`                                                                                                                              |
| Native matris | 10/10 ayak: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64 × Node 22 ve 24                                                |
| Yerel koşu    | `pnpm turbo run test --filter=@sk-mcp/file-core-native --filter=@sk-mcp/file-core --filter=@sk-mcp/excel-mcp --filter=@sk-mcp/xml-mcp` |
| Yerel sonuç   | 613 test: `file-core-native` 2, `file-core` 133, `excel-mcp` 354, `xml-mcp` 124                                                        |

`pack` job'ı aynı koşuda geçti: dört tarball denetleyiciden geçti,
`dist/xml-worker.js` pakette ve `libxml2-wasm` caret'siz `0.7.2`. Temiz tüketici
kurulumu (`smoke-file-packages.mjs`) beş hedefin hepsinde koştu.

İlk koşu (`6e2cd7b`) **kırmızıydı ve sebebi ürün değildi**: native matris 10/10,
dotnet ve XML F0 yeşilken `format:check` düştü — kaynaklar prettier'dan
geçirilmemişti. Düzeltme ayrı bir `style:` commit'i olarak ayrıldı, böylece ürün
değişikliğinin diff'i biçim gürültüsü taşımıyor.

## Ölçülen ve kararı değişen noktalar

| Bulgu                                                                                                             | Sonuç                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **M12** — Düz `next` yürüyüşü ilk PI'da hatasız duruyor; 7 çocuktan 5'i kayıp                                     | Tek `nextSibling()` yardımcısı `XmlTreeNode.prototype`'ın getter'ını ödünç alıyor; `find("node()")` testte oracle     |
| **M13** — PI target'ı public yüzeyde yok, `content` target'tan sonrasını veriyor                                  | `canonicalizeToString()` target'ı üretiyor; private `_nodePtr` okumasına gerek kalmadı                                |
| **M14** — Eski prolog tarayıcısı UTF-32'nin üç varyantını ve EBCDIC'i kaçırıyor, UTF-8 kontrolünü yakalıyor       | Appendix F dört-byte autodetection'ı **BOM'dan önce**; `unsupported_encoding` yalnız buradan üretiliyor               |
| **M15** — Toplu before/after RSS eşzamanlı DOM maliyetini ölçemiyor (her şekilde 0)                               | Marjinal maliyet **ve** şekil başına izole süreç; katsayı on ayakta 8,62–10,06× ve MAD ≤ 0,1007 ile ölçüldü           |
| **M16** — Kayıt byte'ı derinlikle doğrusal büyüyor (120 seviyede 2.940 B/kayıt)                                   | Byte kapısı derin belgelerde `maxNodes`'tan önce bağlıyor; `50 / 200` sayfa değerleri korunuyor, maliyet belgelendi   |
| **M17** — `diag` dispose'ta girdiyi siliyor, yani dispose sonrası sayım tek başına hiçbir şey ölçmüyor            | Disposal oracle'ı iki taraflı: tutulurken 5, dispose'tan sonra 0                                                      |
| **M18** — `xml-lab` `namespace.mjs`'te `Object.entries(root.attrs)` dizi indeksi üretiyordu, satır boşa geçiyordu | `attrs` `XmlAttribute[]` olarak okunuyor; satır artık üç gerçek attribute ölçüyor. Sonuç değişmedi, **ölçüm** değişti |

M12–M18 numaraları bu kayda aittir. F1 kapanışındaki ölçüm tablosunun
`XML_PARSE_NO_XXE` satırı **M11**'dir; iki belgede atıf alıp hiçbir yerde
tanımlanmadığı için bu teslimde açıkça etiketlendi.

## Kalan sınırlar

1. **Prolog'daki comment ve PI'lar adreslenemiyor.** `node.parent` kök elementte
   `null` döndüğü için DOM gezintisiyle erişilemiyorlar; sıralı görünüm belge
   elementinde köklenir. Sözleşme bu sınırı öngörüyor. Adreslenebilir hâle
   getirmek kök-üstü düğümleri `childIndex` numaralandırmasına sokar ve `nodeId`
   tekilliğini yeniden tanımlamayı gerektirir. Sahibi **F5**.
2. **Kayıt byte'ı derinlikle doğrusal.** Element kaydı canonical adresini taşıyor;
   120 seviyede kayıt başına 2.940 byte. Sözleşme adresi şart koştuğu için kabul
   edildi. Adres paylaşımı (ata adresini bir kez gönderip kayıtlarda referans
   vermek) ölçülmüş bir iyileştirme olarak **F4**'e aittir.
3. **`entityReference` F2 corpus'unda üretilemiyor.** DOCTYPE reddedildiği için
   yalnız önceden tanımlı entity'ler kalıyor ve `&amp;` tek bir `XmlText`'e
   eriyor. `kindOf` onu savunma amaçlı tanıyor. Sözleşmenin "entity yazımı
   normalize olabilir" cümlesi böylece ölçüldü.
4. **`unsupported_encoding` yalnız prolog tarayıcısından üretiliyor.** Motorun
   encoding ve well-formedness hatalarını aynı istisnayla bildirmesi değişmedi;
   motor-mesajı eşlemesi hâlâ kapsam dışı. Sahibi **F5**.
5. **`file-core` 1.0 kararı verilmedi.** Değişmedi; karar **F6-08**'dedir.

## Sonraki faza devir

| Nerede                               | Ne                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| [F3](fazlar/03-sorgu-ve-kayitlar.md) | `select_xpath`, `project_records`, `aggregate_document`. `describe_document`'ın alias'ları F3'ün namespace haritasının girdisidir |
| [F4](fazlar/04-buyuk-dosya.md)       | Derin belgelerde adres paylaşımıyla kayıt byte'ının düşürülmesi (kalan sınır 3)                                                   |
| [F5](fazlar/05-genisletmeler.md)     | Prolog comment/PI adreslenmesi (kalan sınır 2), motor-mesajı encoding eşlemesi (kalan sınır 5)                                    |
| [F6](fazlar/06-yayin-ve-kabul.md)    | Platform CI kanıtı, F2-10 katsayısının matriste tekrarı, `file-core` 1.0 kararı, yayın sırası                                     |
