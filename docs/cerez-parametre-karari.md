# `in: cookie` — Çerez Parametresi Birinci Sınıf Konum

**Durum:** kabul edildi — uygulama bu kaydı takip eder
**Tarih:** 24 Eylül 2026
**Kapsam:** `packages/http/spec`, `packages/http/conformance`, `packages/http/core`, `sdks/dotnet`, `sdks/nestjs`, `packages/http/openapi`
**Tersine çevirdiği kayıt:** [fastmcp/deepobject-karari.md](fastmcp/deepobject-karari.md) §9 ve [fastmcp/fastmcp-karsilastirma.md](fastmcp/fastmcp-karsilastirma.md) §5 "Kopyalanmayacaklar"daki `in: cookie` maddesi

---

## 1. Karar

`Parameter.in` dördüncü değeri kazanır: `cookie`. Bir çerez parametresi ajanın gördüğü sıradan bir argümandır; composer bütün çerez parametrelerini tek bir `Cookie` header'ına yazar.

Değişmeyen kural: **kimlik argüman değildir.** Header konumunda `Cookie` ya da `Authorization` adlı bir parametre hâlâ `identity_carrier_argument` ile reddedilir. Kimlik taşıyan çerezler (oturum, token) argüman olamaz; yalnızca carrier olarak, çağıranın kendi isteğinden ya da gateway'in credential'ından gelir.

## 2. Neden — eski gerekçe taşıyıcıyla sahibi karıştırıyordu

Eski kayıt "`Cookie` identity carrier, dolayısıyla çerez parametresi yok" diyordu. Doğru olan ilk yarı: `Cookie` header'ı kimlik taşıyabilir. Yanlış olan çıkarım: çerezlerin hepsi kimlik değildir.

Gerçek backend'ler çerezde veri taşır:

- dil (`lang=tr`) — bazı uygulamalar lokalizasyonu **yalnız** çerezden okur; çerezsiz istek varsayılan dilde döner ve hata vermez;
- para birimi, tenant/şube seçimi, A/B varyantı, görünüm tercihi.

Bu parametreyi temsil edemeyen bir katalog ya endpoint'i düşürür ya da yanlış dilde, yanlış tenant'ta cevap alır — ikincisi sessizdir.

Kimlik modeli değişmedi. Kayıt, çerezin bir **taşıyıcı** olduğunu, değerin kimden geldiğinin ayrı bir soru olduğunu ayırıyor.

## 3. Üç sınıf çerez

| Sınıf  | Örnek                         | Değeri kim verir                                     | Ajan görür mü       |
| ------ | ----------------------------- | ---------------------------------------------------- | ------------------- |
| Kimlik | `session_id`, `ssb_at`, `jwt` | carrier: çağıranın isteği ya da gateway credential'ı | asla                |
| Bağlam | `lang`, `currency`, `tenant`  | küratörlük: `constant` / `deferred` / `omit`         | host gizlerse hayır |
| Veri   | `view`, `sort_pref`           | ajan                                                 | evet                |

Bağlam çerezi yeni bir mekanizma istemez: [argument-curation.md](../packages/http/spec/argument-curation.md)'nin üç dolgusu zaten var. `lang` tek dilli bir kurulumda `constant: "tr"`, çok dilli bir kurulumda `deferred` (sağlayıcı çağıranın profilinden ya da `Accept-Language`'ından okur), backend'in varsayılanı yetiyorsa `omit`.

## 4. Hangi çerez kimlik

Descriptor `Auth.carriers` alanını kazanır: `[{in: header|query|cookie, name}]`, endpoint'in kimlik taşıyıcıları. `(name, in)`'i bir carrier'la eşleşen **veri** parametresi `identity_carrier_parameter` ile reddedilir. Bu, header'daki `Cookie`/`Authorization` ad kuralının genelleştirilmiş hâli.

Carrier listesini kaynak doldurur:

- **OpenAPI:** `securitySchemes` içindeki her `apiKey, in: cookie` şeması bir cookie carrier'dır.
- **Ad deny-list'i:** bir kısmı doküman oturum çerezini hiç ilan etmez. Deny-list'e (`session`, `sid`, `token`, `auth`, `jwt`, adında `sess` geçen; operatör genişletebilir) takılan bir çerez parametresi argüman olmaz, carrier listesine alınır ve `identity_cookie_parameter` uyarısı verilir. Onu karşılayan bir security şeması yoksa ek olarak `identity_cookie_uncovered`.
- **SDK'lar:** ASP.NET Core'da hazır bir `[FromCookie]` binding'i, NestJS'te yerleşik bir çerez decorator'ı yok; uygulamalar çerezi elle okur. Yani gömülü keşif bugün çerez parametresi üretmiyor, ürettiğinde aynı kurala tabi.

Deny-list bir **güvenlik ağı**, sınıflandırıcı değil: adı listeye takılmayan bir oturum çerezi argüman olarak görünür. Bu yüzden OpenAPI'de asıl bilgi kaynağı `securitySchemes`.

## 5. Tel biçimi

İki stil, ikisi de OpenAPI'nin:

| Stil                                  | Değer                                                            | Dizi / nesne            |
| ------------------------------------- | ---------------------------------------------------------------- | ----------------------- |
| `form` (varsayılan, `explode: false`) | RFC 3986 percent-encoding — sonuç her zaman geçerli cookie-octet | `a,b,c` / `k1,v1,k2,v2` |
| `cookie` (3.2)                        | ham yazılır; cookie-octet dışı bir bayt `invalid_cookie_value`   | form ile aynı ayraç     |

`form` + `explode: true` bir çerezde tanımsız (tekrarlanan ad, sunucuların çoğu ilkini okur) ve `unsupported_parameter_style` ile reddedilir. Nesne üyeleri tek seviye, `deepObject` ile aynı kural (`unsupported_object_nesting`).

Çerez adı RFC 6265 token olmalı; değilse `invalid_cookie_name` — ad composer'dan geçmez, yazıldığı gibi header'a girer.

Birden fazla çerez tek header'da `; ` ile, descriptor sırasıyla birleşir. **Tek header** zorunlu: RFC 6265 §5.4 istemcinin tek `Cookie` header'ı göndermesini ister, ve `ComposedRequest.headers` addan değere bir sözlük — ikinci yazım ilkini ezerdi. swagger-js tam bu hatayı yapıyor: her çerez parametresi `req.headers.Cookie`'ye yeniden atanıyor.

## 6. Carrier ile birleşme

Dispatcher, compose çıktısındaki çerezleri runtime carrier çerezleriyle birleştirir (SDK'da çağıranın isteğinden iletilen `Cookie`, gateway'de credential). **Aynı ad iki tarafta varsa `cookie_carrier_collision`, asla ezme.** Hangi tarafın kazanacağına dair bir kural sessiz çözüm olurdu: argüman kazanırsa ajan kimlik çerezini ezer, carrier kazanırsa ajanın değeri haber verilmeden kaybolur.

Carrier çerezi fixture'da `carrierCookies` girdisiyle pinlenir; composer'ın kendisi carrier görmez, birleşme adımı ayrı.

## 7. Reddedilenler

- **Çerezleri varsayılan olarak gizlemek, açık izinle göstermek.** En güvenlisi, ama "OpenAPI'nin temsil edilebilen her özelliği" hedefiyle çelişir ve bağlam çerezlerinin çoğunu (`lang`) ajanın bile göremediği bir boşluğa iter. Gizlemek zaten küratörlükle mümkün.
- **`in: cookie`'yi header'a indirgemek** (`Cookie` adlı bir header parametresi). Header kuralını delmek olurdu; kimlik ile veri aynı slotta buluşurdu.
- **Çakışmada argümanı kazandırmak.** §6.
