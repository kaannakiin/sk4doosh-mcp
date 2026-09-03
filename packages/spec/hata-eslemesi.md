# Hata Eşlemesi

> Statü: **hipotez v0** — iki bağımsız doğrulaması (iki backend / iki framework) olmayan kural normatif değildir.

Backend'in HTTP hatalarını, agent'ın **yalnızca `invoke_tool` sonucunu okuyarak** argümanını düzeltip yeniden deneyebileceği bir MCP sonucuna çevirir; iç detay (stack, bağlantı dizesi, iç yol, kimlik doğrulama gövdesi) hiçbir koşulda sızmaz. Makine-okur karşılığı: [schemas/invoke-result.schema.json](schemas/invoke-result.schema.json); korpus [conformance/error-mapping/](../conformance/error-mapping/).

## İlkeler

- Backend'in HTTP status kodu tek doğruluk kaynağıdır (RFC 9110); sk-mcp yorum eklemez, dokuz kodluk sözlüğe indirger ve iletilebilir olanı iletir.
- Sızıntı filtresi mekaniktir ve her zaman açıktır — kapatma düğmesi yoktur; ham çıktı isteyen host mapper'ın tamamını değiştirir (aşağıda).
- SDK'nın kendi kompozisyon hataları (argüman eşlemesi, `unknown_tool`, `not_invocable`) ile backend'in pipeline'ından dönen hatalar **aynı zarfı** paylaşır; agent'ın tek bir ayrıştırma yolu vardır.
- `invoke_tool` görünürlük filtresine bakmaz ([gorunurluk.md](gorunurluk.md) değişmez 1); bu belge yalnız _sonucun biçimini_ tanımlar, kimin çağırabileceğini değil.

## Tel biçimi

`invoke_tool` sonucu tek bir text content block içinde JSON kalır. Başarı ve hata aynı `CallToolResult` taşıyıcısını paylaşır, `isError` bayrağıyla ayrışır:

- **Başarı** (backend `< 400` döndürdüğünde) → [`InvokeSuccess`](schemas/invoke-result.schema.json): `status`; `body` (content-type JSON ise parse edilmiş değer, değilse `contentType` ile birlikte ham string; gövde yoksa alan hiç yok); `location` (yanıt 3xx yönlendirmesiyse).
- **Her hata** — backend'in 4xx/5xx'i, SDK'nın argüman kompozisyon hataları, `unknown_tool`, `not_invocable` — → `CallToolResult.isError = true` + [`MappedError`](schemas/invoke-result.schema.json) zarfı: `error` (`BackendErrorCode`), `message`, `status` (yalnız backend hatalarında var; SDK-taraflı kodlarda yok), `retryable`, `fields?`, `retryAfterSeconds?`, `reference?`.

`load_tool`'un `unknown_tool` cevabı da (görünürlük tarafından gizlenen ya da gerçekten var olmayan tool için — [gorunurluk.md](gorunurluk.md)) aynı `isError: true` + `MappedError` biçimini kullanır; iki meta-tool tek hata dili konuşur.

JSON-RPC seviyesindeki hata **yalnız** protokol ihlalinde kullanılır (bozuk `arguments` tipi, geçersiz katalog durumu). Backend'in reddettiği bir istek asla JSON-RPC hatasına dönüşmez — her zaman `isError: true` taşıyan normal bir sonuçtur. Gerekçe: agent'ların ve [apps/example-agent-client](../../apps/example-agent-client)'in zaten uyguladığı ayrıştırma budur; iki farklı hata kanalı agent kodunda iki dal ister.

SDK-taraflı kodlar (`unknown_argument`, `invalid_path_type`, `missing_path_parameter`, `header_injection`, `null_not_allowed`, `invalid_type` — [arguman-eslemesi.md](arguman-eslemesi.md); `unknown_tool`, `not_invocable`) aynen korunur, fixture'lıdır ve backend'in status kodundan bağımsızdır: `{ error, message, retryable: false }` (`status` yok, çünkü backend'e hiç ulaşılmadı).

## Kod sözlüğü

Backend'in HTTP status'u aşağıdaki dokuz koddan birine indirgenir. `retryable`, "aynı çağrı sonra başarılı olabilir" anlamına gelir; argümanların yanlış olduğunu göstermez — argüman hatalarında her zaman `false`'dur.

| kod                   | status                                              | retryable | standart mesaj (iletilebilir bir şey yoksa)                                                                                                                     |
| --------------------- | --------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validation_failed`   | 400/422, alan hataları var ya da mesaj dizisi geldi | false     | "The backend rejected one or more arguments. Fix the listed fields and call the operation again."                                                               |
| `bad_request`         | 400, 405, 406, 415, 422 (alansız), diğer 4xx        | false     | "The backend rejected the request ({status}) without usable details. Check the arguments against the input schema."                                             |
| `unauthenticated`     | 401                                                 | false     | "The backend did not accept the caller's identity (401). The MCP session's credentials were forwarded unchanged; retrying with the same session will not help." |
| `forbidden`           | 403                                                 | false     | "The caller is authenticated but not permitted to perform this operation (403)."                                                                                |
| `not_found`           | 404, 410                                            | false     | "No resource matched these arguments (404). The operation exists; check identifier arguments."                                                                  |
| `conflict`            | 409, 412, 428                                       | false     | "The request conflicts with the current state of the resource ({status}). Re-read the resource before retrying."                                                |
| `rate_limited`        | 429                                                 | true      | "The backend is rate-limiting this caller (429). Retry after {retryAfterSeconds} seconds."                                                                      |
| `backend_error`       | 500, 501, diğer 5xx                                 | false     | "The backend failed while handling the call ({status}). Details were withheld. Reference: {reference}."                                                         |
| `backend_unavailable` | 502, 503, 504, 408                                  | true      | "The backend is temporarily unavailable ({status}). Retry later."                                                                                               |

`validation_failed` ile `bad_request` ayrımı status koduna değil **gövdenin yapısına** bakar: 400/422 bir alan sözlüğü (`recognizeFieldErrors`) taşıyor ya da Nest'in mesaj dizisi geliyorsa (`recognizeNestException`) sonuç `validation_failed`; aynı status'larda yapısız tek bir mesaj geldiyse `bad_request`'tir. `408` iki farklı ailede görünmez sanılmasın: burada yalnız `backend_unavailable`'dadır (istemci zaman aşımı değil, backend'in kendini geçici kabul ettiği bir durum olarak okunur).

## Eşleme boru hattı

Saf imza her iki dilde birebir aynıdır:

```
mapInvokeResult(response: BackendResponse, options?: { recognizers?: ErrorRecognizer[]; knownFields?: string[] }): InvokeSuccess | MappedError
```

`BackendResponse = { status, contentType?, headers, body }`. Gövde **bir kez** parse edilir: `ParsedBody = empty | json | html | text` — content-type `application/json`/`text/json`/`*+json` ise ya da content-type hiç yoksa parse denenir; `text/*` asla JSON olarak parse edilmez; HTML her zaman kendi dalındadır.

Sıra, **ilk null olmayan sonuç kazanır**:

1. **Host recognizer'ları**, kayıt sırasıyla.
2. **Status kısa devreleri:** `< 400` → başarı; `401` → standart `unauthenticated` (gövde tamamen yok sayılır); `5xx` → standart mesaj, `reference` yalnız header'dan ya da ProblemDetails `traceId`'sinden gelir.
3. **Yerleşik recognizer'lar**, sırayla:
   - `recognizeFieldErrors` — `{ errors: { alan: string | string[] } }` (ASP.NET `ValidationProblemDetails`, Nest `exceptionFactory`).
   - `recognizeProblemDetails` — `application/problem+json` ya da `{ title | detail, status }`.
   - `recognizeNestException` — `{ statusCode, message: string | string[], error? }`; `message` dizi ve status 400/422 ise alanlar adsız kalır (aşağıya bkz).
   - `recognizeMessageEnvelope` — case-insensitive ilk mevcut anahtar: `message, detail, error_description, error, title, reason`; ya da gövdenin tamamı düz bir JSON string literal'i (`Accept: application/json` gönderdiğimiz için bazı backend'ler `BadRequest("...")` gibi çağrılarda böyle döner).
   - `recognizePlainText` — `text/*` ya da bilinmeyen content-type, HTML değil.
4. **Status-only fallback** — hiçbiri eşleşmediyse kod sözlüğündeki standart mesaj.
5. **Sızıntı filtresi**, host recognizer çıktısı dahil **her iletilen string'e** uygulanır (aşağıya bkz); `Retry-After` header'ı yalnız saniye tam sayısıysa `retryAfterSeconds`'a çevrilir; alan adları normalize edilir.

## Alan hataları

`fields[].name`, backend'in verdiği alan adını `inputSchema.properties` adlarıyla **case-insensitive** eşleştirir (`knownFields` = o tool'un input şemasının property adları); eşleşme yoksa ad backend'in verdiği haliyle korunur. ASP.NET `ValidationProblemDetails`'in JSON-path öneki (`$.quantity`) atılır, kalan `quantity` adla eşleştirilir.

Nest'in `class-validator` çıktısı düz mesaj dizisi olduğunda (alan adı mesajın metnine gömülü, yapılandırılmış değil) alan **adsız** kalır: `fields[].name` yok, yalnız `message` var. Mesaj metninden alan adı tahmini bilinçli olarak yapılmaz — bu dokümante bir sınırdır, Faz 6'da NestJS SDK'sının kendi metadata katmanı geldiğinde yeniden değerlendirilir.

## Sızıntı önleme

Düğmesizdir: aşağıdaki kurallar her kurulumda aynen çalışır.

**A. Hiç iletilmeyenler**

| Kaynak       | Kural                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| 401 gövdesi  | Hiçbir koşulda iletilmez.                                                                                       |
| 5xx gövdesi  | İletilmez; yalnız ProblemDetails `traceId` (≤100 karakter, `^[A-Za-z0-9:_.\-]+$`) varsa `reference`'a taşınır.  |
| HTML gövdesi | Her status için iletilmez.                                                                                      |
| Header'lar   | `retry-after`, `location`, `x-correlation-id`, `x-request-id`, `request-id`, `x-trace-id` dışındakiler okunmaz. |

**B. Her iletilen string'e uygulanan desenler** — eşleşme varsa mesaj status-standart mesajla değiştirilir; alan mesajı özelinde "The value was rejected; details were withheld." kullanılır:

| Desen               | Ne yakalar                                                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stack_frame`       | .NET/Java `at X.Y(`, Node `at ...(file:line:col)`, Python `Traceback`.                                                                                                  |
| `exception_type`    | `\w+Exception`; JS `TypeError \| ReferenceError \| ...`. Bilinçli olarak salt `\bError\b` değildir — "Error: quantity must be positive" gibi masum mesajlar geçmelidir. |
| `file_path`         | Windows/UNC yolları; `/Users`, `/home`, `/var`, `/usr`, `/opt`, `/srv`, `/app`, `/src`, `/etc`, `/tmp` kökleri; `dosya.cs:satır N` biçimleri.                           |
| `connection_string` | `Server=`, `Data Source=`, `Password=` gibi `;`-ayrılı anahtar-değerler; `mongodb\|postgres\|mysql\|redis\|amqp\|mssql://`; URL userinfo.                               |
| `credential`        | `Bearer xxx`; JWT (`eyJ...`).                                                                                                                                           |
| `too_long`          | 1000 karakterden uzun mesaj.                                                                                                                                            |

**C. 403/404/409/400 iletim kuralı:** `detail`/mesaj yukarıdaki desenlerden hiçbirine takılmıyorsa **iletilir**; takılıyorsa standart mesajla değiştirilir.

Allow-list-by-shape (yalnız bilinen zarf biçimlerini iletme) bilinçli reddedilmiştir: motokurye'nin düz `BadRequest("callId zorunludur.")` gibi zarfsız 400 mesajları böyle bir listede kaybolurdu. Kurallar bunun yerine **yapısal** (A) ve **desen tabanlı deny-list** (B) çalışır; zarf biçimini tanımayan ama temiz olan mesaj geçer.

## 401 ve 403 (asimetrik)

401 gövdesi hiçbir koşulda iletilmez — motokurye kanıtı: `JwtAuthenticationMiddleware`'in 401 gövdesi `{"error":"Unauthorized","message":"Portal resolution failed: " + ex.Message}` yazıyor; iç exception mesajı doğrudan agent'a sızabilirdi. 403'te durum farklıdır: `detail` sızıntı filtresinden temiz geçerse iletilir — kaynak-seviyesi bir gerekçe ("başkasının siparişi", "mesai dışı") agent için eyleme dönüştürülebilirdir, oysa 401'de iletilebilir hiçbir gerekçe yoktur: kimlik kanalı zaten sabittir (MCP session'ın taşıdığı credential'lar), aynı session'la yeniden denemek işe yaramaz.

**Gerekçe ("SDK uydurmaz"):** standart mesajlar yalnız backend'in status koduyla kendisi beyan ettiğini (RFC 9110) ve sk-mcp'nin kendisi hakkında bildiğini söyler. 401 gövdesini düşürmek [gorunurluk.md](gorunurluk.md) değişmez 4'ün ("gizlemek gerekçe bildirmez") kimlik doğrulama halidir; 403'ün farklı davranması bu ilkeyle çelişmez, çünkü kaynak-seviyesi red zaten varlığı ifşa etmiştir (endpoint görünür, argüman biçimi doğrudur), yalnız gerekçe eklenir.

## 404

Route mu yanlış kaynak mı yok ayrımı SDK'ca yapılamaz — sk-mcp'nin katalogtan ürettiği route'a, doğru şekilde bileşimlenmiş argümanlarla ulaşıldığı için (tool zaten var, argüman kompozisyonu adım 1-5'i geçti) **kaynak varsayılır**: `not_found`, yönerge kimlik argümanlarını kontrol etmeyi söyler. `410` aynı aileye girer (kaynak vardıydı, artık yok — agent'ın gözünden ayrım anlamsızdır).

## 5xx ve yeniden deneme

500/501 ve listelenmemiş diğer 5xx'ler `retryable = false`'dur: backend'in kendi hatası, aynı argümanla tekrar denemek genelde aynı sonucu verir. Tek istisna `backend_unavailable` ailesi (502/503/504/408): geçici altyapı arızası varsayılır, `retryable = true`. Hiçbir 5xx gövdesi iletilmez; yalnız `reference` (ProblemDetails `traceId` ya da bilinen korelasyon header'ı) taşınabilir.

## Genişletme noktaları

Tam iki nokta — ötesi talep kanıtlanmadan eklenmez ([karar 007](../../docs/kararlar/007-hata-eslemesi.md)):

- **(a) Mapper'ı tümüyle değiştir.** dotnet: `IInvokeResultMapper { InvokeOutcome Map(BackendResponse, IReadOnlySet<string> knownFields) }`, `TryAddSingleton<IInvokeResultMapper, InvokeResultMapper>` ile kayıtlıdır. Nest: `ExtensionPoints.invokeResultMapper`. Ham çıktı isteyen ya da tamamen farklı bir eşleme isteyen host bunu kullanır.
- **(b) Öne recognizer ekle.** dotnet: `options.Errors.Recognize(ErrorRecognizer)`. Nest: `options.errors.recognize(fn)`. Yerleşik recognizer'lardan **önce** koşar (adım 1), çıktısı yine de sızıntı filtresinden (adım 5) geçer. Var olan `Identity.Project`/`Naming.Prefix` delegate stiliyle aynıdır ([karar 003](../../docs/kararlar/003-istek-ustverisi.md)).

**Bilinçli eklenmeyen:** redact/post-process hook'u (filtre zaten mekanik ve hep açık; ham çıktı isteyen (a)'yı kullanır), status başına mesaj override'ı, i18n, `Retry-After`'ın HTTP-date biçimini parse etme.

## Fixture kalıbı

`error-mapping` fixture'ının `input`'u bir [`BackendResponseSpec`](schemas/fixture.schema.json)'tir: `status` (zorunlu), `contentType?`, `headers?` (anahtarlar lowercase), `body?` (string ham metindir; object/array ise harness `JSON.stringify` ile serileştirip parser'a öyle verir), `knownFields?` (`mapInvokeResult`'a geçirilecek alan adı kümesi). `expected`, doğrudan [`invoke-result.schema.json`](schemas/invoke-result.schema.json)'a uyar (`InvokeSuccess` ya da `MappedError`). Zarf ve dizin kuralları için [fixture-formati.md](fixture-formati.md).

## Bilinen sınırlar

- `Retry-After` yalnız saniye tam sayısı olarak okunur; HTTP-date biçimi (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`) desteklenmez — `retryAfterSeconds` o durumda hiç dolmaz.
- Standart mesajlar her zaman İngilizcedir (meta-tool'ların dili — [arama-semantigi.md](arama-semantigi.md)); backend'in kendi diliyle döndürdüğü bir mesaj sızıntı filtresinden temiz geçerse **olduğu dilde** iletilir, çevrilmez.
- Gövde-içi korelasyon kimlikleri (header değil, gövdenin kendi alanı olarak taşınan bir `correlationId`) `reference`'a taşınmaz; yalnız header ya da ProblemDetails `traceId` okunur.
