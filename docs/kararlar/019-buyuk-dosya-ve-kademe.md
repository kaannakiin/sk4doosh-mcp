# 019 — Büyük dosya, kademe ve kayıt parçalama

Tarih: 2026-09-10. Durum: **kabul edildi** — [F4](../xml/fazlar/04-buyuk-dosya.md)
kapıları bu kararı takip eder. Ölçüm dayanağı [XML F2](../xml/xml-f2-kapanis.md)
(M15, M16) ve [XML F3](../xml/xml-f3-kapanis.md) (M23b) kapanış kayıtlarındadır.

[Karar 016](016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md) yanıt bütçesi kapısını
`file-core`'a koydu, [karar 017](017-xml-dugum-modeli-ve-yanit-sayfasi.md) düğüm
kimliğini ve cursor bağını sabitledi. İkisi de belgenin **tamamının** belleğe sığdığı
varsayımı üzerine kurulu. `maxXmlBytes` 8 MiB'dir ve gerçek kullanıcı dosyaları bu
sınırın üstündedir. Bu karar, sınırın üstündeki belgenin nasıl okunacağını ve bunun
tüketiciye görünen yüzeyi nasıl değiştirdiğini sabitliyor.

## Neden ADR

015'in kuralı: tüketiciye görünen sözleşme değişikliği ADR alır. Buradaki kararlar üç
yüzeyi birden bağlıyor — `file-core`'un public kaynak sözleşmesi, iki ürün paketinin
yanıt zarfı ve `capabilities`'in anlamı. XML'e özgü olmadığı için
[XML kararları](../xml/kararlar.md)'nın K-serisine değil, global seriye yazılıyor.

Karar ayrıca bir son tarih taşıyor: `file-core` kaynak sözleşmesi
[F6-08](../xml/fazlar/06-yayin-ve-kabul.md)'in `1.0` kararından **önce** inmelidir.
1.0 bugünkü `bytes`-only `ParseContext`'i dondurursa, `readRange` sonradan breaking
change olur.

## K19-1 — Ürün nişi hedefli erişimdir; rastgele analiz kapsam dışıdır

sk-mcp ajana kod yürütme yetkisi vermez; güvenlik premisi budur. Bunun bedeli, bir
kod sandbox'ının kolayca cevapladığı soruların bir kısmının bu üründe
cevaplanamamasıdır: global sıralama, exact toplam, keyfi aggregate.

Karar: bu bir eksiklik değil, **ilan edilmiş sınırdır**. Ürün "şu alanı bul, şu
kayıtları getir, yapısı nedir" sorularına hizmet eder. Bütçe üstünde `last()`, exact
`count()`, global sıralama ve tüm-belge aggregate açık `unsupported` döner; sessiz
yaklaşık sonuç üretilmez.

Bu, sonraki kararların kapsamını daraltıyor: kaybedilen global işlemler zaten nişin
dışında olduğu için, büyük dosya tasarımının onları kurtarmak gibi bir borcu yok.

## K19-2 — Streaming değil, anlamlı parçalama

Aday iki yaklaşım aynı bedeli ödüyor: her ikisi de dosya üzerinde bir tam ileri geçiş
ve bir konum tarayıcısı gerektiriyor. Kazançları farklı.

Karar: **kayıt sınırından parçalama.** İleri tarama kayıt sınırlarını ve miras bağlamı
(ancestor namespace bildirimleri, `xml:lang`, `xml:base`, `xml:space`) toplar; her
kayıt sentetik iyi-biçimli bir parça olarak libxml2'ye verilir.

|                        | Streaming (SAX)     | Kayıt parçalama              |
| ---------------------- | ------------------- | ---------------------------- |
| Birim içinde yetenek   | dar ileri alt küme  | tam DOM, XPath 1.0 dahil     |
| İkinci parser ne yapar | **değer** üretir    | yalnız **konum** bulur       |
| Hata modu              | sessiz yanlış değer | gürültülü parse hatası       |
| Global sorgular        | yok                 | yok — aynı, daha iyisi değil |
| Tam geçiş              | gerekli             | gerekli                      |

Belirleyici satır üçüncüsü. Streaming'de iki motor kullanıcıya değer üretir ve
anlaşmaları gerekir; parçalamada **libxml2 tek semantik otorite kalır** ve tarayıcının
hatası parse zamanında patlar. Bu, [test stratejisinin](../xml/test-stratejisi.md)
T20'sindeki DOM/streaming parity derdini de ortadan kaldırıyor: karşılaştırılacak
ikinci motor yok.

F4'ün ilk sürümündeki "kesilmiş XML parçası riski" uyarısının üç maddesi bugün zaten
kapalı: DOCTYPE tümden reddedildiği için entity sorunu yok, kesim byte tahmini değil
kayıt sınırı, ve namespace/`xml:*` yığını tarama sırasında zaten elde. Kalan tek
gerçek şart, offsetin **byte** offseti olması.

## K19-3 — Bütçe üstünde yalnız kayıt-şekilli belge desteklenir

İki belge şekli var. Kayıt-şekilli olan tekrar eden kardeş elementlerden oluşur
(fatura, JUnit, log, katalog, ekstre) ve parça **adreslenebilir bir şeye** karşılık
gelir. Düzensiz derin tek ağaçta kesim derinliği dala göre değişir, parça anlamsız bir
kesittir ve adres semantiği bozulur.

Karar: bütçe üstünde yalnız kayıt-şekilli belge. Tekrar eden yapı bulunamazsa açık
`unsupported`; tek başına bütçeyi aşan kayıt açık hata. Derinlik kesimi eklenmez.

Sıra bu yönde olmak zorunda: `unsupported` ile başlanıp ölçülmüş ihtiyaç çıkarsa
derinlik kesimi sonradan eklenebilir. Tersi mümkün değil — derinlik kesimi baştan
girerse adres semantiği kalıcı olarak karışır.

Bu kararın dayandığı "gerçek büyük dosyalar kayıt-şekillidir" iddiası **ölçülmemiştir**
ve repoda doğrulayacak korpus yoktur. F4-L0 bunu ölçen bir ayak taşır; ölçüm aksini
söylerse bu karar yeniden açılır.

## K19-4 — Kademe her yanıtta ilan edilir

Ajan `list_documents`'i de `describe_*`'ı da atlayıp doğrudan bir tool çağırabilir. O
yolda kademeyi ancak ilk hatadan öğrenir; bir tur bedava kayıptır.

Karar: `mode` **her yanıt zarfında** ve ayrıca `list_documents`'ın her girdisinde
bildirilir. İkincisi bedavadır — [listing.ts](../../packages/file-core/src/listing.ts)
`sizeBytes`'ı zaten `scan`'den, byte okumadan döndürüyor.

`capabilities` böylece formatın değil **(format, kademe) ikilisinin** fonksiyonu olur.
`excel-mcp`'nin [capabilities.ts](../../packages/excel-mcp/src/capabilities.ts)'i bugün
`DocumentFormat`'a göre sabit bir tablodur; kademe onu belge açılışında çözülen bir
değere çevirir. Desen korunur, anahtar genişler.

`unsupported` hatası düzeltilebilir olmak zorundadır: hangi yeteneğin neden yok
olduğunu ve bunun yerine ne yapılacağını söyler. [K18-6](018-xpath-ve-kayit-projeksiyonu.md)
tanı kalıbı aynen uygulanır.

## K19-5 — Eşik tek knob, kapasiteler türetilir

[F2-10](../xml/fazlar/02-okuma-mvp.md) `documentCacheSize`'ı tek knob yapıp worker
kapasitesini `W >= 2S-1`'den türetmiş ve invaryantı testle sabitlemişti. Aynı disiplin.

Karar: eşik tek bir knob olarak açılır, türetilen değerler ondan hesaplanır ve
inequality testle sabitlenir. İki ayrı knob açılırsa birbirinden kayar.

Türetilecekler yalnız cache boyutu değil: `maxParseMs` bugün **bir belgeyi** bütçeliyor,
parçalı kademede **bir parçayı** bütçeler; worker cache kapasitesi de parça DOM'una göre
yeniden türetilir.

## K19-6 — Parçalı kademede `nodeId` düşer, `occurrence` kalır

[K17-1](017-xml-dugum-modeli-ve-yanit-sayfasi.md) `nodeId`'yi "bütün çocuk türleri
sayılarak 1 tabanlı `childIndex` yolu" diye sabitledi.
[records.ts](../../packages/xml-mcp/src/records.ts) `childIndex`'i element dalının
dışında artırıyor, yani whitespace text düğümleri de sayılıyor. Bir byte tarayıcısı
libxml2'nin text birleştirme davranışını **parser olmadan** yeniden üretemez.

Karar: `nodeId` parçalı kademede **üretilmez**; opsiyonel alan olur ve yokluğu
`capabilities` üzerinden ilan edilir. `occurrence` — aynı adlı kardeşler arasındaki
sıra — parça-güvenlidir ve adresi yeniden kurmanın zaten belgelenmiş yoludur.

Reddedilen alternatif: `nodeId`'yi parça-göreli üretip sonradan yeniden tabanlamak.
Grameri (`^[1-9][0-9]*(\.[1-9][0-9]*)*$`) sıfır kabul etmiyor, yani göreli bir offset
mevcut biçimde kodlanamıyor; kodlanabilseydi bile K17-1'in belge çapında tekillik
kuralını sessizce delerdi.

Bu karar, F2'nin 2. kalan sınırının ve M23b'nin devraldığı sahipsiz işi de kapatıyor:
kayıt adres yerine `occurrence` taşıyınca derin belgelerde kayıt byte'ı düşüyor.

## K19-7 — Sınır tarayıcısı in-house yazılır; `sax` reddedildi

`libxml2-wasm@0.7.2` push parser, `xmlTextReader` veya SAX **ihraç etmiyor**; tek parse
girişi `xmlReadMemory`. Yani tarayıcı JS tarafında olmak zorunda. Seçenek yok, sadece
kim yazacağı sorusu var.

Karar: in-house byte lexer. `sax` reddedildi:

- `sax` JS string (UTF-16 code unit) üzerinde çalışır, **byte offseti üretmez**.
  Offseti geri kazanmak ikinci bir geçiş ister ve amacı yok eder.
- `sax` **değer** üretir — çözülmüş entity, normalize metin. K19-2 tarayıcının yalnız
  konum üretmesini şart koşuyor; değer üreten tarayıcı bu kuralı ihlale davettir.
- `xml-mcp`'nin üç runtime bağımlılığı var; güvenlik premisli bir üründe dördüncüsü
  ~150 satırlık bir durum makinesi için tedarik zinciri yüzeyidir.

Emsal var: [doctype.ts](../../packages/xml-mcp/src/doctype.ts) zaten in-house byte
lexer'ıdır ve birincil DOCTYPE kapısıdır.

Tarayıcının modellemek zorunda olduğu durumlar: Content, Tag, AttrQuote (`'` ve `"`
ayrı), Comment, CDATA, PI, boş element. DOCTYPE iç alt kümesi kapsam dışıdır çünkü
`doctype.ts` ondan önce reddeder.

**Güvenlik iddiasının şartı:** "yanlış kesim gürültülü hata verir" ancak CDATA, comment,
PI ve attribute tırnağı doğru işlenirse doğrudur. `<![CDATA[</entry><entry>]]>`
iyi-biçimli ama yanlış bir parça üretebilir — bu sessiz hatadır. Bu yüzden tarayıcının
kabul ölçütü diferansiyel oracle'dır, birim testi değil.

**UTF-16 reddi:** tarayıcı byte yönlüdür ama UTF-16'da `<` iki byte'tır. Kalıcı kademe
UTF-16'yı bugün kabul ediyor; parçalı kademe onu açık kodla reddetmek zorundadır, yoksa
sessizce yanlış keser.

## K19-8 — `XmlInputProvider` kullanılmaz

`libxml2-wasm` `XmlInputProvider` ve `xmlRegisterInputProvider` ihraç ediyor ve ilk
bakışta kopya azaltmaya ya da sentetik parça beslemeye yarar görünüyor.

Ölçüldü: yaramıyor. Provider **birincil belge için hiç danışılmıyor** — parse yolu
`xmlReadMemory`'dir. Provider yalnız ikincil kaynaklar (harici DTD, entity, XInclude)
için çağrılır ve onların hepsini `HARDENED` zaten kapatıyor.

Karar: tasarımdan düşer. Dahası `libxml2-wasm/lib/nodejs.mjs`, yol veya `file://` ile
eşleşen **gerçek dosya sistemi provider'ı** ihraç ediyor ve kayıt süreç-globaldir — tam
olarak [K7](../xml/kararlar.md)'nin yasakladığı pathname ile yeniden açma. Worker'ın
import sınırı bu giriş noktasını da kapsayacak biçimde genişletilir ve hiçbir input
provider'ın kaydedilmediği testle sabitlenir.

## K19-9 — Byte-tam kimlik son ana kadar korunur

`contentFingerprint` bugün dosyanın **her byte'ını** hashliyor ve reponun en güçlü
cache-kimlik garantisi buna dayanıyor: aynı boyut ve geri konmuş mtime ile yapılan
içerik değişimi yakalanıyor.

Karar: bu garanti **50 MiB kademesine kadar hiç gevşemez**. O tavana kadar bütün
byte'lar zaten elde olduğu için hash olduğu gibi durur.

Asıl basınç hash'in kendisi değil: [documents.ts](../../packages/file-core/src/documents.ts)
**her `load()`'da** dosyayı yeniden okuyup stamp'i yeniden hesaplıyor, yani her tool
çağrısında. 1 GB'de bu çağrı başına tam okuma demektir.

Çözüm, kimliği zayıflatmak değil, hesabı aşağı indirmektir: native katmana bir `digest`
op'u eklenir, C++ dosyayı aynı TOCTOU disiplini altında akıtır ve 32 byte döner; JS hiç
N byte tutmaz. Fingerprint değeri değişir ama testin **pinlediği özellik** — mtime ve
boyut geri konsa bile byte değişiminin yakalanması — birebir korunur, çünkü digest her
byte'a bağlıdır. Sürüm öncesi cursor'lar `stale_cursor` alır; `isFresh` bunu zaten
kaldırıyor.

Garanti ancak ölçüm 1 GB digest'in kabul edilemez olduğunu gösterirse daralır. O
durumda daralma **yalnız en üst kademeye** hapsedilir, `mode` ile ilan edilir ve alt
kademelerde tam gücünde bırakılır.

## K19-10 — `readRange` hedeftir ve tek native release'te iner

50 MiB, `file-core-native`'in C++'ında **derlenmiş bir sabittir**; bellek sınırı değildir.
Ölçüm belleğin bağlayıcı olmadığını gösteriyor: bugün 8 MiB'de worker ~96 MiB tutuyor,
50 MiB parçalı okuma 8 MiB parça bütçesiyle ~146 MiB tutar. 6,25 kat dosya için ~1,5 kat
bellek.

Karar: `readRange` opsiyonel bir kapı değil, **hedeftir**. Ama sabiti yükseltmek tek
başına da beş platformluk (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`,
`win32-x64`) prebuild turu istediği için, bütçe tavanı + `readRange` + `digest` **tek
release'te** iner. Üçünü ayırmak aynı maliyeti bedava ikiye katlar.

C++'ın koruması gereken iki şey: `readSnapshot`'ın TOCTOU disiplini (stat → oku → bir
byte ötesini yokla → yeniden stat → karşılaştır) aralık başına tekrar edilir; bütçe alanı
`uint32_t` olduğu için 1 GB'de sorun yoktur ama bu **assert edilir**, varsayılmaz.

## Reddedilen alternatifler

- **SAX streaming.** Aynı bedeli ödeyip kayıt içinde tam DOM'u ve tek semantik otoriteyi
  kaybederdi; hata modunu gürültülüden sessize çevirirdi (K19-2).
- **Tam modeli tümden kaldırıp her boyutta parçalamak.** Küçük dosyada kaynak tradeoff'u
  sıfır, yetenek kaybı tam: XPath 1.0, `read_node` rastgele adres erişimi ve Excel'in
  `merges`/`validations`/`conditionalFormats` yetenekleri her dosya için düşerdi.
  Yayınlanmış yüzeyi nadir durum için sakatlamak.
- **Derinlik kesimiyle her belge şeklini desteklemek.** Parça anlamlı bir şeye karşılık
  gelmez, kesim derinliği dala göre değişir ve adres semantiği kalıcı olarak bozulur
  (K19-3).
- **`sax` bağımlılığı.** Byte offseti üretmiyor ve değer üretiyor (K19-7).
- **`XmlInputProvider` ile besleme.** Birincil belge için hiç danışılmıyor (K19-8).
- **Kimliği metadata'ya (size + mtime + örnek hash) indirmek.** Reponun en güçlü
  cache-kimlik testini kırar ve karşılığında yalnız bir hesabı ucuzlatır; native
  `digest` aynı ucuzluğu garantiyi bozmadan veriyor (K19-9).
- **`readRange`'i ölçülmüş ihtiyaca bağlı opsiyonel kapı bırakmak.** F4'ün ilk
  sürümündeki duruş buydu; `bytes`-only sözleşmenin 1.0'da donması riskini görmüyordu.

## Sürümler

| Paket                      | Önce  | Sonra | Gerekçe                                                           |
| -------------------------- | ----- | ----- | ----------------------------------------------------------------- |
| `@sk-mcp/file-core`        | 0.2.0 | 0.2.0 | Bu kayıt kod değiştirmiyor; kaynak sözleşmesi F4-L6'da minor alır |
| `@sk-mcp/file-core-native` | 0.1.0 | 0.1.0 | Bütçe tavanı, `readRange` ve `digest` F4-L7'de tek release        |
| `@sk-mcp/xml-mcp`          | 0.3.0 | 0.3.0 | `mode` alanı F4-L1'de minor alır                                  |
| `@sk-mcp/excel-mcp`        | 0.4.0 | 0.4.0 | Bu turda uygulama yok; ortak sözleşme ve kanıt kapısı             |
