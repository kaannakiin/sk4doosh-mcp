# Karar 016 — İkinci dosya sunucusu ve yanıt bütçesi

Tarih: 2026-09-09. Durum: **kabul edildi, kodla kanıtlandı**; platform CI bekleniyor.
Ölçümler [XML F1 kapanış kaydında](../xml/xml-f1-kapanis.md).

Bu karar [karar 015](015-dosya-kaynagi-cekirdegi.md)'in parametrelediği maddelerin ölçülmüş
cevaplarını verir. 015 kapalı ve tarihli bir kayıttır; iki maddesi burada **geri alınıyor**,
dolayısıyla cevap 015'in içine yazılmaz, buraya yazılır ve oradan bağlanır.

## Ne yapıldı

`packages/xml-mcp` eklendi ve `@sk-mcp/file-core`'un ikinci tüketicisi oldu. Aynı değişiklikte
çekirdeğe yanıt byte bütçesi girdi: her tool yanıtı — başarı, hata ve recovery dahil —
`coreLimits.maxPayloadBytes` kapısından geçiyor.

015'in çıkarma gerekçesi buydu: _"`xml-mcp` yazmak, 342 satırlık güvenlik testiyle korunan
sandbox kodunu ikinci kez yazmak anlamına geliyordu."_ Kopya yazılmadı; `xml-mcp`
`paths`/`listing`/`documents`/`cursor`/`errors`/`formats`/`tools`/`server`/`cli` yüzeyinin
tamamını tüketiyor ve kendi katmanı yalnız XML'e özgü olanı ekliyor.

## Yanıt bütçesi kapısı

`coreLimits.maxPayloadBytes` (512 KiB) 015'ten beri bir **sabit** olarak duruyordu ve
çekirdekte hiçbir yerde uygulanmıyordu. Tek uygulama tüketicide, ad-hoc ve iki yönden
hatalıydı; ölçülen sonucu ve düzeltmesi [kapanış kaydındadır](../xml/xml-f1-kapanis.md).

Yeni yüzey `packages/file-core/src/payload.ts`: `measureJson`, `createPageBudget`,
`clampJsonField`; ve `unicode.ts` içinde `truncateUtf8`.

**Kapı `guard`'dadır, `json()`'da değil.** Bu bir tercih değil, zorunluluk: `json()`
`guard`'ın `try`'ı içinde çağrılıyor. Çıplak bir `FileSourceError` fırlatsaydı tüketicinin
`normalize`'ı onu kendi sınıfından olmadığı için sessizce `internal_error`'a düşürürdü.
Kapı try/catch'in dışında, handler döndükten sonra ölçer.

**Çift uygulama kuralı:** ürünün kendi sayacı (Excel'in satır sayacı gibi) daha erken
durdurabilir; kapıyı devre dışı bırakamaz. Sayaç tasarlanmış yoldur ve ürünün yazdığı iyi
bir recovery mesajı taşır; kapı ise hiç sayfalamamış bir tool için bile geçerli olan
backstop'tur. Bir tüketici sayacı unutursa yanıt aşmaz, gürültülü `resource_limit` olur.

`toToolError` önce `redactRoot` uygular, sonra kırpar — redaksiyon uzatabilir (`/a` → `[path]`).
`message` kırpılır, `recovery` yalnız boş mesaj bile sığmazsa düşer: `recovery` sunucu
yazımı ve sınırlıdır, `message` saldırgan etkisine açık olan eksendir.

Sonuç bir davranış değişikliğidir ve yönü bilinçlidir: **fazla büyük bir başarı artık
kırpılmış bir başarı değil, bir hatadır.** Çekirdek bilmediği bir payload'ı kırpamaz —
hangi diziyi kısaltacağını ve nasıl işaretleyeceğini bilmek format bilgisidir. Sessizce
kırpmak ajana tam sandığı bir sonuç verirdi; bu `resource_limit`'ten kesinlikle kötüdür.

## Sürümler

| Paket               | Önce    | Sonra       | Gerekçe                                                                                                                                                               |
| ------------------- | ------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@sk-mcp/file-core` | `0.1.0` | **`0.2.0`** | Eklenen public yüzey + `guard`/`toToolError` davranış değişikliği. `guard` bağlamı artık zorunlu `fail` alıyor                                                        |
| `@sk-mcp/excel-mcp` | `0.3.0` | **`0.4.0`** | Yayınlanan bağımlılık aralığı `^0.2.0`'a taşındı ve her yanıt artık yeni bir kapıdan geçiyor; yeni bir başarısızlık kipi minor'dür                                    |
| `@sk-mcp/xml-mcp`   | —       | **`0.1.0`** | [paket-yerlesimi](../paket-yerlesimi.md)'nin ürün paketi başlangıç numarası. 015:200 lockstep'i tam da `xml-mcp`'yi 0.3.x'ten başlatmaya zorlayacağı için reddetmişti |

`libxml2-wasm` `xml-mcp`'de **exact `0.7.2`**, runtime `dependencies`. Caret, bir tüketicinin
kurulumunun on ayaklı F0 matrisinden hiç geçmemiş bir motor sürümüne kaymasına izin verirdi.
CI tarball denetleyicisi bunu artık makine olarak zorluyor.

**`1.0` yapılmadı.** 015:31 `0.x` kilidinin _kalkma şartını_ tanımlar, majör sürüm vermez;
karar [F6-08](../xml/fazlar/06-yayin-ve-kabul.md)'dedir ve o görev "otomatik file-core 1.0
yükseltmesi yok" diye yazılıdır.

## 015'in parametrelediği maddelerin cevapları

### `text-encoding` çıkarması — **çıkarılmadı, ve bu bilinçlidir**

015:149 bu maddeyi "`xml-mcp` değişikliğinde çıkarılır" diye ertelemişti. İkinci tüketici
gelince seam iki taraftan da ölçüldü ve **örtüşme yalnız BOM tablosu çıktı**.

| Parça                    | Karar                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BOM tablosu              | **Çıkarıldı** → `packages/file-core/src/bom.ts`, saf veri, throw yok                                                                                                  |
| `EncodingName` birleşimi | **Kaldı.** `windows-1254`/`iso-8859-9`/`windows-1252` Türkçe Excel'in yazdığı kod sayfalarıdır; XML hiçbirini adlandırmaz                                             |
| `TextDecoder` kullanımı  | **Kaldı.** Tek tüketici değil — ikinci tüketicinin mimarisi onu _dışlıyor_: K1 `XmlDocument.fromBuffer`'ı sabitler, XML byte'ı motora verir ve JS'te hiç decode etmez |
| `undecodable_text`       | **Kaldı.** Tier-3 Excel kodudur; XML'in karşılığı ayrı bir politikadır                                                                                                |
| BOM'suz UTF-16 sezgisi   | **Kaldı** (`xml-mcp`'de). Excel'in `assertNoNulBytes`'ı kasten daha zayıf bir soruyu farklı bir politika için soruyor                                                 |

Çekirdeğe giren tablo throw etmez ve `EncodingName` sızdırmaz; UTF-32 üyeleri daraltıldıktan
sonra Excel'in birleşimine **cast'siz** atanır. Excel kendi `undecodable_text`'ini üstte
fırlatmaya devam eder, XML ise reddeder — aynı tablo, iki politika. İki tüketici kanıtı budur.

Bu madde artık ertelenmiş değil, **kapalıdır**. Yeniden açmak için `TextDecoder` tabanlı
çözmeye ihtiyaç duyan üçüncü bir sunucu gerekir.

### Tier-2 tablo katmanı — tetikleyici ateşlemedi

015:145 tetikleyiciyi `pdf-mcp` tablo çıkarımı diye yazmıştı, "`xml-mcp` var olması" diye
değil. `xml-mcp` geldi, tetikleyici ateşlemedi, katman `excel-mcp`'de kaldı. Doğrulandı.

### `capabilities.ts` — desen kopyalandı, yüzey üretilmedi

015:206 bunu öngörmüştü. `xml-mcp` ortak bir yetenek arayüzü üretmedi.

### CI ters filtresinin gerçek kapsamı — **015:34 dar bir düzeltme alıyor**

015:34 `--filter='!@sk-mcp/sdk-dotnet'` için _"`xml-mcp` ve `pdf-mcp` artık var oldukları an
kapsanır"_ diyor. Ölçüldü: bu **yalnız `node` job'ının test adımı** için doğru.
`native` ve `pack` job'larındaki dört satır hâlâ açık izin listesidir ve `xml-mcp` oraya
elle eklendi. Yeni bir ürün paketi bugün de dört satır ister.

Bu düzeltme kayda geçiyor çünkü aksi halde bir sonraki paketin yazarı ifadeye güvenip
hiç paketlenmeyen, tarball denetiminden ve temiz kurulum testinden hiç geçmeyen bir paket
gönderir.

## Reddedilen alternatifler

- **`text-encoding`'i simetri için yine de çıkarmak.** Ortak olmayan davranışı ortak bir isim altında birleştirmek olurdu. 015'in cetveli ("her dosya okuyan sunucunun ihtiyacıdır") karşılanmıyor.
- **Bütçeyi ürün başına uygulamak.** Bugünkü durum buydu ve ölçülen sonucu 273 byte'lık sessiz bir aşımdı. Gelecekteki tüketicinin unutamayacağı tek yer çekirdektir.
- **`guard` bağlamındaki `fail`'i opsiyonel yapmak** (kırıcı olmamak için). Garanti opt-in olurdu ve "hiçbir tüketici unutamaz" argümanı çökerdi. Ayrıca property pozisyonundaki contravariance kontrolü kaybolurdu.
- **Kapıyı `json()`'a koymak.** Tüketicinin `normalize`'ı hatayı `internal_error`'a düşürürdü; ölçüldü.
- **`file-core`'u `1.0.0`'a çıkarmak** çünkü 015:31'in şartı karşılandı. 015 kilidi kaldırır, majör vermez; karar F6-08'dedir.
- **`createDocumentStore`'a "gelecekteki formatlar için" disposal hook'u eklemek.** F0-07 ölçtü, K6 karar verdi: worker sahipleniyor ve store yalnız serileştirilebilir handle tutuyor. Hook'suz kalmak, K6'nın cevabının doğru kalmasının şartıdır.
- **F2-01/02/03'ü F1 kimliklerine taşımak.** [README](../xml/README.md)'nin yönetim kuralı görev kimliklerini dondurur; ayrıca beş belge o kimliklere referans veriyor.
- **`libxml2-wasm`'ı caret ile almak.** F0-01 bütünlük kaydını sessizce geçersiz kılardı.
