# Faz 3 — Notlar

Tarih: 2026-09-01. Kapsam: adım 1 (spec + şema temeli) ve adım 2 (keşif + isimlendirme + seçim) tamam; adım 3 (meta-tool'lar + arama) başlıyor. Adım planı: `~/.claude/plans/sequential-inventing-wozniak.md` (repo dışı); bu döküman kalıcı kayıt.

## Yönlendirici kısıt

SDK backend-agnostic kalır ve .NET'in kendi evreninde hareket eder: yalnız framework sözleşmelerini okur (`IAllowAnonymous`, `IAuthorizeData`, `IAuthorizationFilter`, `Endpoint.Metadata`, ApiExplorer). Hiçbir host'a özgü attribute/tip SDK'da adıyla geçmez. Bir backend framework sözleşmesini implement etmiyorsa düzeltme host tarafındadır. İlk taslak bunu ihlal ediyordu (host'un `RequirePermissionAttribute`'unu okuyan adapter); kullanıcı geri çevirdi, mimari buna göre yeniden kuruldu.

## Alınan kararlar

- **TFM:** `net8.0;net9.0;net10.0` multi-target. Uyumluluk için değil (net8 kütüphanesi net10 host'ta zaten çalışır), API/davranış drift'ini derlemede yakalamak için. Üçü de temiz derleniyor.
- **C# tipleri şemadan üretilir.** [sdks/dotnet/scripts/generate-types.mjs](../../../sdks/dotnet/scripts/generate-types.mjs) → `Generated/Spec.cs`; turbo `gen` task'ı, `build`/`lint` ona bağlı. `fixture.schema.json` üretilmez (oneOf union'ları; testler `JsonElement` okur). `required` anahtar sözcüğü sayesinde şemaya alan eklemek her construction site'ı derleme hatasına çeviriyor — `imperative` ve `container` eklenirken doğrulandı. Alternatif (elle iç tip + test-içi mapper) reddedildi: şema değişimini yalnız fixture yakalar, kapsam dışı alanda sessiz drift.
- **Seçim = hiyerarşik attribute, en özel kazanır** — [secim-hiyerarsisi.md](../../../packages/spec/secim-hiyerarsisi.md). Global default `exclude`. Aynı seviyede çakışma `ambiguous_selection`; daha özel seviye ezecek olsa bile hata (çelişkili kaynak kod raporlanmadan bırakılmaz).
- **Görünürlük üç değerli** (`allow`/`deny`/`unknown`), iyimser semantik, 5 kurallı sıralı saf çekirdek — [gorunurluk.md](../../../packages/spec/gorunurluk.md). `Auth`'a `imperative` alanı eklendi; `"guard:X"` yer tutucusunun yerine geçti. İmperatif mantık `policies`'e ad yazmaz, yalnız bayrağı kaldırır.
- **Probe tier'ı adım 5'e ertelendi.** Adım 4 yalnız T0+T1 ile biter; kalan `unknown` → görünür.
- **İsimlendirme üç revizyon** (aşağıdaki ölçümle): kısaltma dizisi tek kelime; bir operasyon = bir tool (`(container, operationId, metod)` kimliği, en kısa route); uzunluk 64 → 256 hard + >64 `long_tool_name` uyarısı. 64'ün ne MCP'de (`Tool.name` düz string) ne Anthropic API'sinde (`^[a-zA-Z0-9_-]{1,256}$`) karşılığı vardı. Karakter kümesi katı kaldı: ad üretilir, hiçbir endpoint'i reddetmez.
- **`EndpointDescriptor.container`** eklendi: operasyon kimliği ve seçim hiyerarşisi için. `tags` agent'a dönük gruplama, `container` bildiren grubun kimliği — ASP.NET'te ikisi de controller'dan gelir ama amaçları farklı.
- **`inputSchema` üretim kuralları** normatif hale geldi ([metadata-sozlesmesi.md](../../../packages/spec/metadata-sozlesmesi.md)): `properties`/`required` boş olsa da yazılır; parametre `description`'ı şemanınkini ezmez; body düzleşir; `required` sırası parametreler sonra body.

## Gerçek backend ölçümü (motokurye, 718 endpoint)

İki bağımsız ölçüm, ikisi de 718: kaynak dosyalardan script ile çıkarım ve gerçek ApiExplorer (aşağıda). 25 controller, 9'u aynı `[Route("Rest")]` prefix'inde.

İsimlendirme, revizyon öncesi/sonrası:

|                                              | önce                | sonra        |
| -------------------------------------------- | ------------------- | ------------ |
| Kaybedilen endpoint (operationId yolu)       | 15                  | 4            |
| Kaybedilen endpoint (route yedeği)           | 38 (`invalid_name`) | 0 (38 uyarı) |
| Okunamaz ad (`get_mapping_d_t_o_properties`) | 29                  | 0            |

Çakışmaların ayrışması belirleyiciydi: 15'in 10'u **tek action, iki route** (legacy `/Rest/X` + `/Rest/Auth/X`) — spec'te hiç ele alınmamış vaka; "operationId tanımla" çözümü işlemez. Kalan 4 farklı controller'da jenerik action adı (`Delete`, `List`, `Create`, `GetStatus`) — kural 4'ün yakalamak için var olduğu vaka, host `[EndpointName]` tanımlar (%0.6). Koşulsuz container prefix'i reddedildi: ortalama ad 20→29 karakter, koşullu uygulanması ad stabilitesini ihlal ederdi.

ApiExplorer probe'u (boot yok, DB yok: `WebApplication` + `AddApplicationPart(hostAssembly)` + `MapControllers`, hosted service kayıtsız):

| Ölçüm                                         | Değer                                               |
| --------------------------------------------- | --------------------------------------------------- |
| Yüklenen tip / yükleme hatası                 | 154 / 0                                             |
| ApiExplorer gördüğü                           | 718                                                 |
| Routing endpoint'i                            | 718                                                 |
| Katalog girdisi                               | 694 = 718 − 10 form-bound − 4 çakışma − 10 birleşen |
| RequestTemplate kurulan                       | 694/694                                             |
| `imperative` / çıplak kimlik / anonim         | 444 / 250 / **0**                                   |
| Body / path / query / header parametresi olan | 214 / 389 / 91 / 0                                  |

`anonymous: 0` adım 2 kuralının (yalnız `IAllowAnonymous`) sonucuydu: host'un kendi `AllowAnonymousAttribute`'u `IAllowAnonymous` implement etmiyor. Adım 4'ün framework-gerçeği kuralıyla (`IAuthorizeData` yok + fallback yok → anonim) tablo tersine döner: 718'in tamamı framework gözüyle anonimdir — 444 imperatif olan `unknown`, 250 çıplak olan `allow`. İki durumda da yaptırım invoke anındaki custom middleware'dedir; `: IAllowAnonymous` eklemek yine de doğru, framework'ün kendi authz middleware'i de saygı duymaya başlar. `imperative: 444`, class-level `[RequirePermission]`'ın her action'a düşmesinden — `IAuthorizationFilter` framework sözleşmesi olduğu için host tipi bilinmeden yakalandı.

## Sürprizler / teknik notlar

- **DI'daki `EndpointDataSource` app başlamadan boş.** `MapControllers` sonrası bile `app.Services.GetRequiredService<EndpointDataSource>()` sıfır endpoint döndü; katalog `ActionDescriptor.EndpointMetadata` yedeğine düştü. Doğru kaynak `IEndpointRouteBuilder.DataSources` (probe'da `CompositeEndpointDataSource` ile 718). Adım 3'te `MapSkMcp` bu yoldan okuyacak; convention'la eklenen metadata (`RequireAuthorization()` gibi) yalnız orada görünür.
- **Form-bound endpoint'ler kataloğa girmemeli.** İlk sürüm form parametresini atlayıp tool üretiyordu — invoke'da kırılırdı. Şimdi `unsupported_binding` tanısıyla atlanıyor (10 endpoint; karar 004'te multipart bilinçli kapsam dışı).
- ApiExplorer `RelativePath` route kısıtlarını zaten soyuyor (`{portalId}`); normalize adımı yine de tutuluyor.
- DTO property adları adım 2'de CLR adıyla üretiliyordu; adım 3'te wire adına geçildi (aşağıda). motokurye'de iki yol da bağlanır (`DefaultContractResolver` PascalCase korur, Newtonsoft eşlemesi duyarsız) — orada `naming_policy_unresolved` tanısı çıkacak ve CLR adı kullanılacak.
- `EncryptedJsonInputFormatter`/`OutputFormatter`: probe resource-filter aşamasında kesileceği için model binding'e hiç ulaşmaz; gerçek invoke için deneme portalında `EncryptionEnable` kapalı olmalı. Prod'da `UseHttpsRedirection` var → `Synthetic.Scheme = "https"` gerekecek.

## Fixture korpusu

31 → 40: `selection/` 6, `visibility/` 10, `metadata-extraction/` +5 (annotation tablosunun beş satırı, body düzleşmesi, description önceliği), `naming/` +4 (kısaltma, tek operasyon çok route, farklı container çakışması, farklı metod çakışması). Faz 2'den devreden madde kapandı: `naming` ve `metadata-extraction` artık C#'ta gerçekten koşuyor ([CatalogFixtureTests.cs](../../../sdks/dotnet/tests/SkMcp.Tests/CatalogFixtureTests.cs)). Fixture linkleme `%(RecursiveDir)` desenine geçti. Adım 3-4 sonunda korpus 53: `search/` 10, `visibility/` 13; her tür hem C#'ta hem core TS'te koşuyor.

## Adım 3 — meta-tool'lar, arama, agent client (2026-09-01)

`AddSkMcp()` artık MCP server'ı da kaydeder (`AddMcpServer().WithHttpTransport().WithTools<SkMcpMetaTools>()`); `app.MapSkMcp("/mcp")` kataloğu `IEndpointRouteBuilder.DataSources`'a bağlar ve `ApplicationStarted`'da ısıtıp tanıları loglar. Katalog ilk kullanımda kurulur; ölümcül tanı (`name_collision`, `ambiguous_selection`, `invalid_name`) varsa meta-tool'lar `SkMcpCatalogException` ile kapalı kalır. `OrderTools.cs` silindi; DemoApi yalnız keşifle çalışıyor — Faz 1'in 200/403/401 matrisi keşif üzerinden birebir yeniden üretildi. [arama-semantigi.md](../../../packages/spec/arama-semantigi.md) yazıldı, `search` fixture türü + 10 fixture eklendi (korpus 40 → 50).

Kararlar:

- **Önek eşleşmesi.** İlk ASCII tokenizer `sipariş`'i `ş`'de kesip kazara eşleştiriyordu; Unicode'a geçince Türkçe ekler (`siparişi`, `siparişe`) sorguyla tam eşleşmez oldu. Çözüm dil-bağımsız: sorgu token'ı ≥3 karakterse belge token'ının öneki olunca eşleşir. Gövdeleme sözlüğü yok; tersi (sorgu belge token'ından uzun) kapsanmaz, spec bunu söyler.
- **Body property adları wire adlarıdır.** `Text` (CLR) yerine `text` (STJ camelCase policy + `[JsonPropertyName]`). Karar 003 cetveli: host hook `options.Schema.PropertyName`; yoksa `Microsoft.AspNetCore.Mvc.JsonOptions`; Newtonsoft input formatter tespit edilirse tahmin etmez — CLR adı + `naming_policy_unresolved` tanısı. Newtonsoft'a bağımlılık alınmadı (tespit tip adıyla). Adım 2'deki "adım 6'ya erteleme" kararı geri alındı: DemoApi'de `text` argümanı reddedilince tutarsızlık demoda görünür hale geldi.
- **Bir operasyon = bir tool** ve `[EndpointName]` → operationId DemoApi'de gösterildi (`AddNote` action'ı `add_order_note` oldu).
- `[McpTool(ReadOnly/Destructive/Idempotent)]` override'ları: en özel seviye kazanır, `null` olan alan tabloyu ezmez ([CatalogHostTests](../../../sdks/dotnet/tests/SkMcp.Tests/CatalogHostTests.cs) C7).
- Karar 004'te açık kalan `/mcp` self-dispatch kilidi kapandı: `MapSkMcp` pattern'i katalogda rezerve prefix'tir, o prefix'teki endpoint seçilse bile kataloğa girmez (C10).

n=2 kanıtı: `packages/core`'a isimlendirme, seçim, tool tanımı ve arama TS olarak yazıldı; C#'ın geçtiği 40 fixture'ın tamamı ilk koşuda TS'te de geçti — BM25 sıralaması ve önek eşleşmesi dahil. Bu, adım 1-3'te eklenen her kuralın iki bağımsız implementasyonla doğrulandığı anlamına gelir.

`apps/example-agent-client`: resmi MCP TS SDK'sı (`StreamableHTTPClientTransport`) ile ara → yükle → çağır; `SKMCP_USER=alice` → 200 / exit 0, `bob` → 403 / exit 1. Otomasyon hedefi hazır.

Sürprizler:

- Test projesi Web SDK olmadığı için `[EndpointName]` ve `EndpointDescriptionAttribute` implicit using'siz; `WithDescription` uzantısı OpenApi paketinde — testte framework'ün kendi `EndpointDescriptionAttribute` metadata'sı kullanıldı.
- `search_tools` sonucundaki `total` seçilmiş tool sayısı; görünürlük gelince çağıranın gördüğü sayı olacak.

## Adım 4 — görünürlük T0+T1 (2026-09-01)

Planı yeniden okuyunca ölçümlerle çelişen dört boşluk çıktı; dördü de spec'e girdi (kullanıcı onayı):

- **Kimlik üç değerli:** `CallerFacts.authenticated: boolean` → `identity: present | absent | unknown`. Gerekçe motokurye: authentication scheme'i yok, kimlik custom middleware'de; `AuthenticateAsync` cevap veremez. `absent`'e kırmak 694 tool'u gizlerdi. Yeni kural 4: kimlik gerekli + kimlik bilinmiyor → `unknown`. 10 fixture migre, 3 yeni (korpus 50 → 53).
- **`[Authorize]`'sız endpoint framework'te anonimdir** (fallback policy yoksa). Katalog `IAllowAnonymous` VEYA (`IAuthorizeData` yok VE `GetFallbackPolicyAsync()` null) kuralını uyguluyor. Anonim endpoint'te `policies` boş (framework'te de kısa devre).
- **Roller değerlendirilebilir:** `[Authorize(Roles="a,b")]` → `policies: ["roles:a,b"]`; T1 öneki tanıyıp `RequireRole` policy'si kuruyor. Adım 2'deki "roller → imperative" muhafazakârlığı kaldırıldı.
- **`load_tool` filtreye tabi:** `deny` → `unknown_tool` (var olmayanla aynı cevap); `unknown` → `authUncertain: true`. `invoke_tool` dokunulmadı (değişmez 1).

Mekanizma: `SyntheticRequestFactory` dispatcher'dan ayrıldı — görünürlük ve invoke sentetik isteği **aynı koddan** kuruyor (değişmez 2 yapısal). T1: `IAuthenticationSchemeProvider.GetDefaultAuthenticateSchemeAsync()` → null ise kimlik `unknown`; `IAuthenticationService.AuthenticateAsync` → `present`/`absent`; policy başına `IAuthorizationPolicyProvider.GetPolicyAsync` → requirement beyaz listesi (`DenyAnonymous`, `Claims`, `Roles`, `Name`) → `IAuthorizationService.AuthorizeAsync(principal, resource: null)`; beyaz liste dışı (`AssertionRequirement`, custom) → `unknown`. Policy sonuçları arama başına bir kez, ad başına çözülür; 700 tool'da saf birleştirme mikrosaniye.

V matrisi ([VisibilityTests.cs](../../../sdks/dotnet/tests/SkMcp.Tests/VisibilityTests.cs), üç host: JWT, JWT + `OnUnknown = Hide`, authentication'sız) 12/12 ilk koşuda: V1 anonim görünür · V2 kimliksiz gizli · V3 iki kimlik iki liste · V4 rol deklaratif · V5 sahiplik görünür + invoke 403 · V6 assertion/custom requirement/`IAuthorizationFilter` belirsiz · V7 gizli tool tahminle çağrılınca pipeline 403 · V8 `Identity.Clear()` ile filtre ve invoke birlikte 401 · V9 `Hide` · V10 policy adı sızmıyor · V11 gizli == yok · V12 scheme yoksa belirsiz, gizli değil. DemoApi dört kimlikle: anon 2, bob 5, carol 6, alice 7 tool. Core TS aynası: 13 görünürlük fixture'ı 13/13.

## Adım 5 — probe tier (2026-09-01)

Opt-in (`Visibility.Tier = Probe`), yalnız deklaratif katmanın `unknown` bıraktığı endpoint'lere, sıralama sonrası ilk K'ya (default 25). Tamamen framework sözleşmesi:

- **Bayrak** `HttpContext.Items`'ta (`IsSkMcpProbe()` public); V17 gerçek isteğin header'la açamadığını sabitliyor.
- **Kesme:** `IAuthorizationMiddlewareResultHandler` dekoratörü (host'unki varsa sarılır, `ServiceDescriptor` üzerinden) + global `IAsyncResourceFilter` (`MvcOptions.Filters`, `int.MinValue`). Her ikisi de bayraksız istekte no-op; Tier'dan bağımsız hep kayıtlı.
- **Uygunluk:** MVC action VEYA (deklaratif yetki verisi VE güvenli metot). Güvenli olmayan minimal API probe edilmez (V16) — plan'ın "handler koşma riski alınmaz" kuralı.
- **Karar:** `401/403` → deny, bayrak olsun olmasın (custom middleware yetki katmanından önce reddeder — motokurye yolu, V18); bayrak + başarı → allow; bayraksız başka her şey → unknown, o tool için probe kalıcı kapanır + uyarı (işaretsiz 404 = route eşleşmedi, `ProbeValues` beyanı gerekir).
- **Yer tutucu:** `RoutePattern.PathSegments`'tan, kısıta göre (`int`→1, `guid`→boş, `bool`→true, `datetime`→2000-01-01). Query/body yok — kesme model binding'den önce, `EncryptedJsonInputFormatter` gibi formatter'lar hiç koşmaz.

**V13 gerçek bir tasarım hatası yakaladı.** İlk sürümde sonuç işleyici başarıda hemen kesiyordu; `[Authorize]` + imperatif `IAuthorizationFilter` taşıyan MVC action'da filter hiç koşmadan `allow` çıkıyordu (bob `vis_filter`'ı görüyordu). Düzeltme: sonuç işleyici reddi her yerde kaydeder, başarıda yalnız MVC-olmayan endpoint'i keser; MVC'de `next`'e geçer, verdict'i authorization filter'larından sonra resource filter okur. Spec'e yazıldı.

V13–V19 (7 test) + önceki 12: 19/19. V15 yan etki kanıtı: POST MVC endpoint'i probe edildi, statik sayaç değişmedi; invoke'da +1. DemoApi'de `summary?` işareti kalktı (assertion policy probe ile çözüldü — zaman-bazlı olduğu için bob dahil herkes görüyor, doğru).

Dürüstçe: probe minimal API'de yalnız GET/HEAD + `[Authorize]` kombinasyonunu kapsıyor; imperatif `IEndpointFilter`'lı minimal API'ler her zaman `unknown` kalır. Bilinçli sınır.

## Header hattının denetimi (2026-09-02)

Soru: dış MCP isteğinden header'ı doğru alıyor, sentetik isteğe doğru veriyor muyuz? Üç bulgu, hepsi düzeltildi.

**Alma doğru, testi yoktu.** `tools/call`'da `IHttpContextAccessor.HttpContext` o çağrıyı taşıyan POST'un kendisi: MCP C# SDK her POST'un `ExecutionContext`'ini mesaja iliştirip işlerken geri yükler (`PerSessionExecutionContext` default `false`, `HttpServerTransportOptions` XML doc'u). Yani `Authorization` session'a değil çağrıya bağlı — token yenilenirse sonraki çağrı yenisini taşır. Ama V matrisi dış isteği elle `DefaultHttpContext` kurarak veriyordu, transport'u atlıyordu: SDK upgrade'i bu default'u değiştirse kimse görmezdi. **V21** eklendi — `HttpClientTransport` + TestServer ile gerçek `initialize` + `tools/call`, iki bearer iki liste, elle kurulan bağlamla birebir aynı sonuç.

**`ConnectionInfo` boştu.** Sentetik istekte `Connection.RemoteIpAddress` null'dı. motokurye'nin global rate limiter'ı partition anahtarını `RemoteIpAddress?.ToString() ?? "unknown"` ile kuruyor (`Program.cs:276`) — tüm agent trafiği tek kovaya düşüp birbirini kilitliyordu; `Program.cs:566` null'da `"127.0.0.1"` dönüyor, yani agent isteği loglarda loopback görünüyordu. Dış isteğin bağlantı bilgisi artık yansıtılıyor (karar 003 M8). Uydurma yok: dış istek yoksa boş kalır, loopback asla yazılmaz (IP allowlist'te yetki yükseltmesi olurdu).

**"Bu MCP ise" dalı için güvenilir sinyal yoktu.** Host'un elindeki tek işaret `User-Agent: sk-mcp/…` idi; dış istek onu taklit edebilir, o yüzden gevşetme dalı için uygun değil. `IsSkMcpRequest()` eklendi (karar 003 M9), probe bayrağının kardeşi, `HttpContext.Items`'ta. Host tarayıcıya özgü dönüşümlerini (motokurye'de AES+gzip formatter'ları, `TouchLastPing`, erişim logu, rate limit) bununla atlar. **Gövde/yanıt dönüşüm hook'ları eklenmedi:** sentetik istek hiç kablo görmez, gövde aynı process içinde `MemoryStream` — şifrelemek sıfır güvenlik değeri. Doğru soyutlama dönüşümü taklit etmek değil, agent'ı ayrı client tipi olarak tanıtmak.

Header sözleşmesi de netleşti: MCP'nin tek standart kimlik kanalı `Authorization`; tenant/portal header'ının karşılığı yok ve her client özel header göndermeye izin vermez. Backend'in beklediği ek header client'tan istenmez, host `Identity.Project` ile tokendan/default'tan türetir. Yeni ayar gerekmedi. V matrisi 19 → 21, üç TFM build yeşil.

## Ertelenenler

- Şema sadeleştirme (generic wrapper soyma, derinlik, recursion `$ref`, readonly düşme) → adım 6. Property naming policy adım 3'te çözüldü; Newtonsoft host'lar için hook beyanı gerekiyor.
- Üç TFM test matrisi + gerçek boot ile uçtan uca → adım 7. motokurye branch'inde gereken host değişiklikleri: `AllowAnonymousAttribute : IAllowAnonymous`, 4 endpoint'e `[EndpointName]`, tarayıcıya özgü dönüşümlerde `IsSkMcpRequest()` dalı, `x-enrollment` için `Identity.Project` (tokende portal claim'i varsa oradan).
- Bağlantı yansıtması (M8) ve sentetik istek işareti (M9) NestJS'te aynalanmadı — Express karşılıkları `socket.remoteAddress` ve `req[Symbol]`/`res.locals`. n=2 kuralı gereği kural henüz tek implementasyonda.
