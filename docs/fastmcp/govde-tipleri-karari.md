# İstek Gövdesi Tipleri — Form, Multipart, Dosya Argümanı, JSON Ailesi, Düz Metin

**Durum:** kabul edildi — uygulama bu kaydı takip eder
**Tarih:** 23 Eylül 2026
**Kapsam:** `packages/http/spec`, `packages/http/conformance`, `packages/http/core`, `sdks/dotnet`, `sdks/nestjs`, `apps/docs` — HTTP katalog ürün hattı
**Kaynak tartışma:** [fastmcp-karsilastirma.md](fastmcp-karsilastirma.md) §4.8

---

## 1. Karar

İstek gövdesi artık yalnız JSON değil. Descriptor'ın `requestBody`'si tek bir somut `contentType` taşır; yoksa `application/json` demektir, yani mevcut her descriptor ve fixture bayt bayt aynı kalır. Desteklenen aileler:

| Aile                                             | Tel                                                    |
| ------------------------------------------------ | ------------------------------------------------------ |
| JSON (`application/json`, `text/json`, `*+json`) | aynı baytlar, yalnız header değişir                    |
| `application/x-www-form-urlencoded`              | query encoder'ının aynısı, charset parametresiz        |
| `multipart/form-data`                            | alan başına part; dosya alanı her zaman `filename` ile |
| `text/plain`                                     | yalnız string kök                                      |

Geri kalan her media type `unsupported_binding` ile düşer — kodun anlamı "form veya dosya" değil, "bu media type için writer yok" olarak daraldı.

Dosya argümanının üç kaynağı var: `text` (ajanın kendi ürettiği içerik), `base64` (çağrı başına bütçeli) ve `ref` (host'un bağladığı bir `FileResolver` port'u üzerinden). sk-mcp depolamanın ne olduğunu bilmez — `db-core`'un sürücüye, `pdf-mcp`'nin OCR'a durduğu yerde durur. Resolver bağlı değilse `ref` şemada hiç görünmez.

## 2. Neden — iki sessiz hata ve bir düşen sınıf

1. **415 döndüren tool'lar.** İki SDK da her gövdeye sabit `application/json; charset=utf-8` yazıyordu ve `[Consumes]` / `IAcceptsMetadata` hiç okunmuyordu. `[Consumes("application/merge-patch+json")]` taşıyan bir endpoint katalogda görünüyor, ajan çağırıyor, backend 415 dönüyor (`FormBindingProbeTests.P3`). Tool var ama hiçbir çağrıda çalışmıyordu.
2. **Her sentetik istek bir bağlantı kopması gibi görünüyordu (Nest).** Node'un HTTP parser'ı `IncomingMessage.complete`'i set eder; elle kurulmuş bir mesajda kimse etmiyordu. Stream'in auto-destroy'u body tüketilir tüketilmez `aborted` yayıyordu — yani `aborted` dinleyen her handler sahte bir istemci kopması görüyordu. multer bunu gerçek abort sayıp 500 dönüyor. Bu iş olmadan multipart hiç çalışamazdı; düzeltmesi tek satır ve bu işten bağımsız (`N2`).
3. **Form ve dosya endpoint'leri hiç görünmüyordu.** `[FromForm]`, `IFormFile`, `@UploadedFile` → endpoint düşüyor. Kurumsal .NET backend'lerde `[FromForm]` action'lar ve ek dosyalı "ticket aç" tipi endpoint'ler yaygın.

## 3. Değişmez bölünmedi — çıktı yapılandırıldı

`argument-mapping.md:5`: aynı girdiye her SDK aynı çıktıyı üretir. Multipart'ın boundary'si rastgele, yani ham bayt bu kuralı taşıyamaz. Composer bu yüzden **yapılandırılmış** bir gövde döner: JSON değeri, düz metin, **encode edilmiş** urlencoded dizesi ya da part listesi. Urlencoded dizesi deterministik olduğu için fixture onu olduğu gibi pinler ve iki dilin encoder'ı arasındaki kaymayı yakalar; boundary ve part header'larını SDK yazar ve fixture'a hiç girmez. Core hâlâ hiçbir header yazmaz.

Nesne değerli form alanı `deepObject`'in çözümünü aynen devralır: notation descriptor'a yazılır (`dot` .NET, `bracket` Nest), composer aynı girdiye aynı baytı verir, fixture tek `expected` taşır ([deepobject-karari.md](deepobject-karari.md) §3).

## 4. Seçim kuralı

Bir endpoint birden fazla tip kabul ediyorsa sıra: `application/json` → diğer JSON tipleri beyan sırasıyla → dosya alanı yoksa urlencoded → multipart → `text/plain`. Wildcard ve parametreler atılır. Kabul edilen her tip doğru olduğu için bir tanesini seçmek çakışma değil; FastMCP'nin "ilk beyan edilen kazanır" kuralı ise sonucu listenin sırasına bağlıyor ve alınmadı.

Host beyanı (`consumes`) seçimi ezer, ama backend'in kabul ettiği listede değilse `content_type_not_accepted` ile düşer — backend'le çelişen bir beyan sessizce çözülmez.

## 5. Ölçülen gerçekler

Tasarımın her kısıtı kurulu framework'e karşı ölçüldü; hiçbiri sözleşme değil, hepsi probe testiyle pinli (`sdks/dotnet/tests/SkMcp.Tests/FormBindingProbeTests.cs`, `sdks/nestjs/test/form-body-probe.spec.ts`).

**ASP.NET**

| Probe | Gerçek                                                                                                                                                 | Sonuç                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| P1    | Düz `[FromBody]` için `SupportedRequestFormats` = `application/json`, `text/json`, **literal** `application/*+json`                                    | wildcard seçimden atılır                                                                          |
| P2    | `[Consumes("application/merge-patch+json")]` için `SupportedRequestFormats` **boş**; tip yalnız `IAcceptsMetadata`'da                                  | kaynak endpoint metadata'sı, liste değil                                                          |
| P3    | Aynı endpoint `application/json`'a 415, kendi tipine 200                                                                                               | §2.1'in hatası                                                                                    |
| P4    | `[FromForm]` DTO nokta'lı leaf'lere düzleşir, `IFormFile` üye `FormFile` kaynaklı, tüm leaf'ler tek `ParameterDescriptor` paylaşır, format listesi boş | gruplama anahtarı `deepObject`'inkiyle aynı                                                       |
| P5    | Üst düzey `IFormFile` tek leaf, `multipart/form-data` beyan eder; `IFormFileCollection` tek leaf                                                       | dosya dizisi                                                                                      |
| P6    | Tekrarlanan anahtar `List`'e bind olur; `Address.City` **ve** `Address[City]` ikisi de bind olur                                                       | query'nin aksine form bracket'i kabul ediyor; `dot` yine seçildi, çünkü iki yüzeyde aynı notation |
| P7    | `FormReader` percent-escape baytlarını Content-Type'ın charset'iyle çözer: `charset=us-ascii` ile `%C4%B0` → `??`                                      | urlencoded charset parametresiz yazılır                                                           |
| P8    | Bir part ancak `filename` taşıyorsa dosyadır; non-ASCII ad gidip gelir                                                                                 | dosya adı her zaman yazılır                                                                       |
| P9    | `[FromBody] string` + `text/plain` → 415, text formatter kayıtlı değil                                                                                 | `text/plain` yalnız formatter beyan ettiğinde seçilir                                             |
| P10   | Minimal API form endpoint'i antiforgery ister, token'sız istek 400; `.DisableAntiforgery()` kapatır                                                    | `form_antiforgery_required`                                                                       |
| P11   | Minimal API form endpoint'i `multipart/form-data` + `application/x-www-form-urlencoded` beyan eder                                                     | kaynak yine `IAcceptsMetadata`                                                                    |

**Nest (Express)**

| Probe | Gerçek                                                                                                                         | Sonuç                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| N1    | Varsayılan urlencoded parser (`extended`) qs bracket'lerini, tekrarlanan anahtarı ve UTF-8 escape'i çözer; `a.b` literal kalır | `bracket` zorunlu                                                         |
| N2    | multer sentetik istek üzerinde çalışır — `complete` düzeltmesinden sonra; metin alanları string gelir                          | §2.2                                                                      |
| N3    | Düz `filename="…"` içindeki UTF-8 ad **latin1** olarak çözülür                                                                 | non-ASCII ad `filename*=UTF-8''…` ile yazılır                             |
| N3b   | RFC 5987 `filename*` UTF-8 olarak çözülür                                                                                      | iki SDK aynı header'ı yazar                                               |
| N4    | Beyan edilmemiş alan adı `400 Unexpected field - <ad>`                                                                         | yanlış bir `files` beyanı sessiz değil, yüksek sesle düşer                |
| N5    | `FilesInterceptor` tekrarlanan dosya alanını dizi olarak toplar                                                                | dosya dizisi                                                              |
| N6    | `application/merge-patch+json` ve `text/plain` gövdeleri varsayılan parser'larla **parse edilmez**, `req.body` boş kalır       | Nest'te JSON ailesi `application/json`'a çöker; `text/plain` parser ister |
| N7    | Parser'lar Express router stack'inde adlarıyla görünür (`jsonParser`, `urlencodedParser`, `textParser`)                        | `body_parser_missing` tespit edilebilir                                   |

## 6. Dosya argümanı

Şema: `text` | `base64` | `ref` alanlarından **tam olarak biri**, artı opsiyonel `name` ve `mediaType`. `oneOf` burada güvenli: bir operasyonun `inputSchema`'sı `load_tool` cevabında veri olarak döner, istemcinin function-calling katmanına kayıt edilmez; `ArgumentFill` zaten `oneOf` kullanıyor.

- **Bütçe.** `invoke.maxInlineFileBytes` (1 MiB) çağrı başına decode edilmiş `base64` toplamı; composer'da aritmetikle hesaplanır, fixture'la pinlenir. `invoke.maxFileBytes` (16 MiB) çözülen dosya başına; resolver'a da iletilir ki yüklemeden reddedebilsin. `text`'in bütçesi yok — ajan onu zaten token olarak üretiyor. Limit şemaya yazılmaz; red mesajı onu sayı olarak verir ve resolver bağlıysa `ref`'i önerir.
- **Katılık.** base64 RFC 4648 §4: boşluk yok, url-safe alfabe yok, uzunluk 4'ün katı. .NET `Convert.FromBase64String` boşluğu yok sayar, JS `Buffer.from` neredeyse her şeyi kabul eder; kapı olmasa iki SDK aynı argümanda ayrışırdı. Dosya adında `"`, CR, LF, NUL, `/`, `\` yasak — ajanın verdiği ad backend'in `Path.Combine(dir, file.FileName)`'ine gidebilir.
- **Çözüm yeri.** `ref`, dispatcher'ın içinde, invoke deadline'ı kurulduktan **sonra** çözülür. Nest bir çağrıda iki kez compose ediyor (biri doğrulama için); takılan bir resolver deadline'dan kaçmamalı.
- **Yetki.** `ref` ajanın yazdığı bir dizedir, bir yetki değil. Resolver onu çağırana (`McpCaller`) karşı yetkilendirmek zorunda; `not_found` ve `forbidden` aynı mesajı döner, böylece hangi ref'in var olduğu yoklanamaz.

## 7. Reddedilenler

**İç içe alan için JSON part.** OpenAPI'nin varsayılanı nesne alanı için `application/json` part'ı, ama ASP.NET'in form binder'ı JSON part'ı complex `[FromForm]` property'sine çözmüyor. Bunun yerine bir seviye, notation ile — `deepObject`'in sınırlarıyla aynı.

**`file` adını tahmin etmek (Nest).** `FileInterceptor("attachment")`'in alan adı closure'da yaşıyor, metadata'dan okunamıyor. `@McpTool({ files })` beyanı ya da `swagger/apiParameters`'taki `format: binary` şeması; ikisi de yoksa `unresolved_file_field`. Tahmin, yanlış olduğunda backend'in sessizce görmezden geldiği bir alan üretirdi — N4 yanlış beyanın en azından yüksek sesle düştüğünü gösteriyor.

**sk-mcp'nin kendi upload endpoint'i.** SEP-2631 (bant dışı upload + `mcp-file://` handle) taslak ve sponsorsuz; bugün tahmin ettiğimiz şekil standart gelince kırılırdı. `ref` port'u o standardın taşıyacağı handle'ı bugünden kabul edebilecek şekilde tasarlandı.

**data URI.** SEP-2356'nın kuralı: kodlanmış değer model context'ine girmemeli. data URI tam olarak context'e giren şey.

**Antiforgery'yi atlamak.** Bir güvenlik kontrolünü delmek sk-mcp'nin kararı değil. Endpoint düşer; mesaj host'a `.DisableAntiforgery()` seçeneğini söyler.

**MVC'nin filter tabanlı antiforgery'si.** `[ValidateAntiForgeryToken]` ve `AutoValidateAntiforgeryToken` endpoint metadata'sı değil, filter; discovery yalnız `IAntiforgeryMetadata`'yı (minimal API, `[RequireAntiforgeryToken]`) okuyor. Filter'ı tanımak, `IgnoreAntiforgeryToken` dahil en yakın politikayı çözmeyi gerektirir. Böyle bir endpoint çağrıda backend'in 400'ü ile yüzeye çıkıyor — sessiz değil.

**Streaming gövde.** İki dispatcher da gövdeyi bellekte tutuyor; `maxFileBytes` bunun sınırı. Stream'e geçiş ayrı bir iş.

## 8. Kodlar

| Kod                                                                                    | Tür              | Sonuç                                                 |
| -------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------- |
| `unsupported_binding` (daraldı), `unsupported_body_shape`, `content_type_not_accepted` | diagnostic       | endpoint düşer                                        |
| `form_antiforgery_required`                                                            | diagnostic, .NET | endpoint düşer                                        |
| `unresolved_file_field`, `body_parser_missing`                                         | diagnostic, Nest | endpoint düşer                                        |
| `invalid_file_argument`, `file_too_large`, `file_unresolved`                           | `SdkErrorCode`   | `file_unresolved` yalnız `unavailable` iken retryable |

Yeni tanı kodları iki severity tablosuna aynı değişiklikte girer — `duplicate_argument`'ın tablolarda unutulması (`deepObject` Aşama 0) tekrarlanmasın.

## 9. JSON Patch — sonradan kapatıldı

İlk teslimde ertelenmişti: header doğru gidiyordu ama şema yanlıştı, yani tool listede olup hiçbir çağrısı geçemiyordu. Bu, endpoint'i hiç listelememekten kötü; ertelemenin gerekçesi ("referans verilmeyen paketi ad üzerinden tanımak ayrı karar") da tutmadı, çünkü Microsoft aynı kararı aynı gerekçeyle vermiş.

**Ölçülen önceki çıktı** (`JsonPatchSchemaTests`, düzeltmeden önce):

- Newtonsoft `JsonPatchDocument<T>`: `{Operations: [...], ContractResolver: {}}` — nesne.
- System.Text.Json `JsonPatchDocument<T>`: `Operations` artı `SerializerOptions`'ın reflection'ı; `Assembly`, `TypeInfo`, `MethodInfo`… onlarca `$defs`.
- `AddNewtonsoftJson` açıkken ApiExplorer tipi `Operation[]` olarak yeniden yazıyor (`JsonPatchOperationsArrayProvider`): dizi, ama `op` enum'u yok ve `value` nesne tipli — string değer gönderen ajan şemayı ihlal ediyor.

**Karar.** İki namespace'teki (`Microsoft.AspNetCore.JsonPatch`, `….SystemTextJson`) `JsonPatchDocument` / `JsonPatchDocument<T>` ve türevleri ad ve namespace üzerinden, base type zinciri yürünerek tanınır ve `verbatim` düğümle RFC 6902 dizisine bağlanır. Şema Microsoft.AspNetCore.OpenApi'nin .NET 10'daki şemasının aynısı (dotnet/aspnetcore#63052): `oneOf` ile `add|replace|test` (`value`), `move|copy` (`from`), `remove`. Microsoft yalnız System.Text.Json varyantını kapsıyor; biz Newtonsoft'u da kapsıyoruz, çünkü .NET 8 host'larının yolu o. Host'un `TypeSchema` beyanı yine önce gelir. Newtonsoft'ta gövde tipi ApiExplorer'dan değil action parametresinin kendi tipinden okunur.

**Yol üstünde bulunan önceden var olan hata — minimal API JSON gövdesi hiç okunmuyordu.** `RequestDelegateFactory` JSON gövdesini yalnız `IHttpRequestBodyDetectionFeature.CanHaveBody == true` iken okuyor; sentetik `DefaultHttpContext` bu feature'ı taşımıyor. Sonuç: sk-mcp üzerinden çağrılan her minimal API tipli JSON gövdesi "Implicit body inferred … but no body was provided" ile 400 dönüyordu; gövde opsiyonelse handler sessizce `null` alıyordu. MVC etkilenmiyordu, form okuması da (`CanHaveBody == false` kontrolü, null'da geçer) etkilenmiyordu; bu yüzden hiçbir test yakalamamıştı — mevcut minimal API testi ham stream okuyordu. Dispatcher artık Kestrel gibi feature'ı her istekte kuruyor (`CanHaveBody` = gövde yazıldı mı). `MinimalJsonBodyHostTests` bunu pinliyor; satır kaldırılınca MJ1, MJ2 ve minimal JsonPatch testi kırılıyor, controller testleri geçiyor.
