# Faz 3 — Notlar

Tarih: 2026-09-01. Kapsam: adım 1 (spec + şema temeli) ve adım 2 (keşif + isimlendirme + seçim) tamam; adım 3 (meta-tool'lar + arama) başlıyor. Adım planı: `~/.claude/plans/sequential-inventing-wozniak.md` (repo dışı); bu döküman kalıcı kayıt.

## Yönlendirici kısıt

SDK backend-agnostic kalır ve .NET'in kendi evreninde hareket eder: yalnız framework sözleşmelerini okur (`IAllowAnonymous`, `IAuthorizeData`, `IAuthorizationFilter`, `Endpoint.Metadata`, ApiExplorer). Hiçbir host'a özgü attribute/tip SDK'da adıyla geçmez. Bir backend framework sözleşmesini implement etmiyorsa düzeltme host tarafındadır. İlk taslak bunu ihlal ediyordu (host'un `RequirePermissionAttribute`'unu okuyan adapter); kullanıcı geri çevirdi, mimari buna göre yeniden kuruldu.

## Alınan kararlar

- **TFM:** `net8.0;net9.0;net10.0` multi-target. Uyumluluk için değil (net8 kütüphanesi net10 host'ta zaten çalışır), API/davranış drift'ini derlemede yakalamak için. Üçü de temiz derleniyor.
- **C# tipleri şemadan üretilir.** [sdks/dotnet/scripts/generate-types.mjs](../../../sdks/dotnet/scripts/generate-types.mjs) → `Generated/Spec.cs`; turbo `gen` task'ı, `build`/`lint` ona bağlı. `fixture.schema.json` üretilmez (oneOf union'ları; testler `JsonElement` okur). `required` anahtar sözcüğü sayesinde şemaya alan eklemek her construction site'ı derleme hatasına çeviriyor — `imperative` ve `container` eklenirken doğrulandı. Alternatif (elle iç tip + test-içi mapper) reddedildi: şema değişimini yalnız fixture yakalar, kapsam dışı alanda sessiz drift.
- **Seçim = hiyerarşik attribute, en özel kazanır** — [selection-hierarchy.md](../../../packages/spec/selection-hierarchy.md). Global default `exclude`. Aynı seviyede çakışma `ambiguous_selection`; daha özel seviye ezecek olsa bile hata (çelişkili kaynak kod raporlanmadan bırakılmaz).
- **Görünürlük üç değerli** (`allow`/`deny`/`unknown`), iyimser semantik, 5 kurallı sıralı saf çekirdek — [visibility.md](../../../packages/spec/visibility.md). `Auth`'a `imperative` alanı eklendi; `"guard:X"` yer tutucusunun yerine geçti. İmperatif mantık `policies`'e ad yazmaz, yalnız bayrağı kaldırır.
- **Probe tier'ı adım 5'e ertelendi.** Adım 4 yalnız T0+T1 ile biter; kalan `unknown` → görünür.
- **İsimlendirme üç revizyon** (aşağıdaki ölçümle): kısaltma dizisi tek kelime; bir operasyon = bir tool (`(container, operationId, metod)` kimliği, en kısa route); uzunluk 64 → 256 hard + >64 `long_tool_name` uyarısı. 64'ün ne MCP'de (`Tool.name` düz string) ne Anthropic API'sinde (`^[a-zA-Z0-9_-]{1,256}$`) karşılığı vardı. Karakter kümesi katı kaldı: ad üretilir, hiçbir endpoint'i reddetmez.
- **`EndpointDescriptor.container`** eklendi: operasyon kimliği ve seçim hiyerarşisi için. `tags` agent'a dönük gruplama, `container` bildiren grubun kimliği — ASP.NET'te ikisi de controller'dan gelir ama amaçları farklı.
- **`inputSchema` üretim kuralları** normatif hale geldi ([metadata-contract.md](../../../packages/spec/metadata-contract.md)): `properties`/`required` boş olsa da yazılır; parametre `description`'ı şemanınkini ezmez; body düzleşir; `required` sırası parametreler sonra body.

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

`AddSkMcp()` artık MCP server'ı da kaydeder (`AddMcpServer().WithHttpTransport().WithTools<SkMcpMetaTools>()`); `app.MapSkMcp("/mcp")` kataloğu `IEndpointRouteBuilder.DataSources`'a bağlar ve `ApplicationStarted`'da ısıtıp tanıları loglar. Katalog ilk kullanımda kurulur; ölümcül tanı (`name_collision`, `ambiguous_selection`, `invalid_name`) varsa meta-tool'lar `SkMcpCatalogException` ile kapalı kalır. `OrderTools.cs` silindi; DemoApi yalnız keşifle çalışıyor — Faz 1'in 200/403/401 matrisi keşif üzerinden birebir yeniden üretildi. [search-semantics.md](../../../packages/spec/search-semantics.md) yazıldı, `search` fixture türü + 10 fixture eklendi (korpus 40 → 50).

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

**Gerçek tokenla header denetimi.** Kaan'ın canlı A003 portalı tokeni (`sub: User.28`, 15 dk ömür) ve motokurye'nin beklediği iki header (`x-enrollment: Web`, `x-portalcode: A003`) üzerinden tüketici taraması:

- `x-portalcode` bearer'la gelen istekte **hiç okunmuyor** — tek okuyucu cookie fallback yolu (`JwtAuthenticationMiddleware:89`, `Authorization` boşsa cookie'den token çıkarmak için portal ayrıştırıcı). Portal `pc` claim'inden çözülüyor. Agent için gereksiz.
- `x-enrollment`'ın tek tüketicisi `ShouldFillCustomDesingJson()` (`CustomUserControlService:2080`): yokluğunda `true`, yani custom design JSON'u yanıta ekleniyor. `Web` değerinde `false`. Patlamıyor; tek etkisi yanıt gürültüsü. Agent için `Identity.Project` ile sabit `Web` yazmak yanıtı küçültür, zorunlu değil.
- **Gerçek bloker `enc`/`gzip` claim'leri.** Bu tokende ikisi de `1`: `JwtAuthenticationMiddleware:231-237` bunları `CurrentSessionContext`'e yazıyor, `EncryptedJsonOutputFormatter:51-52` yanıtı AES+gzip'liyor (dispatcher düz string okur → agent'a çöp), `EncryptedJsonInputFormatter:46` gövdeli invoke'u `x-encrypted: true` olmadan reddediyor. `Accept-Encoding` kuralı (M7) burada korumaz: gzip formatter'ın içinde, response compression değil. İki çıkış yolu: `enc=0`/`gzip=0` token, ya da host'ta `IsSkMcpRequest()` dalı — ikincisi **M10 ile prova edildi**, dal olmadan aynı host tarayıcı isteğinde şifreli yanıt/400 verirken sentetik istek düz JSON alıyor.

Header sözleşmesi de netleşti: MCP'nin tek standart kimlik kanalı `Authorization`; tenant/portal header'ının karşılığı yok ve her client özel header göndermeye izin vermez. Backend'in beklediği ek header client'tan istenmez, host `Identity.Project` ile tokendan/default'tan türetir. Yeni ayar gerekmedi. M matrisi 7 → 10, V matrisi 19 → 20 (V21 transport; bağlantı/işaret kanıtı karar 003 matrisine taşındı), üç TFM build yeşil.

## Gerçek backend entegrasyonu (2026-09-02, adım 7 başlangıcı)

motokurye'de `sk-mcp/faz-3-dogrulama` branch'i. Host tarafı değişiklikler ölçüldüğü gibi çıktı, iki sürpriz üretti.

**Paketleme sürprizi: ProjectReference multi-target'ı geçemiyor.** motokurye `global.json` ile SDK 8.0.0 (`rollForward: latestFeature`) pinliyor; SkMcp `net8.0;net9.0;net10.0` hedefliyor. `ProjectReference` restore'da tüm TFM'leri değerlendirdiği için `NETSDK1045: The current .NET SDK does not support targeting .NET 9.0` alınıyor — `SetTargetFramework="TargetFramework=net8.0"` metadata'sı bunu **çözmüyor**. Çözüm `dotnet pack` + `RestoreAdditionalProjectSources` ile yerel besleme: paket net8.0 varlığını seçiyor, host'un SDK pini korunuyor. Gerçek dağıtım yolu da bu, yani doğru olan. Ders: multi-target bir SDK'yı eski SDK pinli host'a ProjectReference ile bağlamak mümkün değil, dökümanda paket yolu tek yol olarak anlatılmalı.

**İsim çakışması: `ParameterLocation`.** `SkMcp.AspNetCore` kök namespace'i `ParameterLocation` ihraç ediyor ([RequestTemplate.cs:5](../../../sdks/dotnet/src/SkMcp.AspNetCore/RequestTemplate.cs#L5)); `Microsoft.OpenApi.Models` de aynı adı taşıyor. Swashbuckle kullanan host'ta `using SkMcp.AspNetCore;` eklemek `CS0104 ambiguous reference` veriyor — motokurye'de `Program.cs:220`'de patladı, host tarafında tam nitelikli ada geçilerek aşıldı. Bu **SDK'nın kusuru**, host'un değil: Swagger ASP.NET dünyasında istisna değil kural. Aynı risk taşıyan diğer kök adlar: `ParameterKind`, `ParameterBinding`, `ComposedRequest`, `DispatchResult`, `PipelineHolder`. `Generated/Spec.cs` zaten `SkMcp.AspNetCore.Spec` altında olduğu için `Parameter`/`RequestBody` güvende. Düzeltme yönü: istek kompozisyonu tiplerini alt namespace'e taşımak (`SkMcp.AspNetCore.Requests`), yalnız `AddSkMcp`/`MapSkMcp`/`SkMcpOptions`/`IsSkMcpRequest` gibi giriş yüzeyini kökte bırakmak. Public API kırılması olduğu için ayrı iş.

Host değişiklikleri (hepsi host kodu, SDK'ya dokunulmadı): `AllowAnonymousAttribute : IAllowAnonymous`; `AddSkMcp` (`Synthetic.Scheme = "https"`, `Selection.Default = Include`, `Visibility.Tier = Probe`); `UseSkMcpCapture()` ilk middleware; `MapSkMcp("/mcp")`; iki formatter'da `IsSkMcpRequest()` dalı (`forceEncryption` da atlanıyor, yoksa agent şifreli çöp alır). 718 endpoint için attribute yolu pratik değil, `Include` default'u bu yüzden.

### Ölçüm: 718 endpoint, canlı host (2026-09-02)

Katalog gerçek boot'ta kuruldu: `sk-mcp catalog: 718 discovered, 718 selected, 698 tools, 11 diagnostic(s)`. Fatal yok. Tanılar: 1 `naming_policy_unresolved` (Newtonsoft, beklenen) + 10 `unsupported_binding` (form gövdesi, beklenen). `long_tool_name` yok. 24 container, 215 gövdeli, 390 path parametreli, 91 query parametreli, 0 header parametreli; 698/698 template kuruldu.

**Çakışma soruşturması.** İlk koşuda 4 `name_collision` çıktı ve `search_tools` fatal tanı yüzünden hata verdi (`EnsureValid`). Çakışanlar: `delete` (Notification + PushProviderConfig), `list` (PushProviderConfig + WorkflowEndpoint), `create` (SupportRequest + WorkflowEndpoint), `get_status` (License/Portals/{portalId}/Status + SqlStudio/Status). Host tarafında 4 `[EndpointName]` ile çözüldü, tool sayısı 694 → 698.

Buradaki asıl soru şu: **ASP.NET aynı isimlerle hiç çakışma yaşamıyor, biz neden yaşadık?** Çünkü ASP.NET'te kimlik `(method, route template)`; `/Rest/Notification/Delete/{id}` ile `/Rest/PushProviderConfig/Delete/{id}` ayrı, üstelik action'lar ayrı tiplerde. Bizim isimlendirme ise tekilliği `(container, operationId, method)` üzerinden tanımlıyor ama **ürettiği adda container yok** — kimliğin parçası olan bir alan adın parçası değil. Hiyerarşi kurgusu yanlış değil; sorun MCP tool adlarının **düz isim uzayı** olması. Hiyerarşik bir kümeyi düz uzaya taşırken ya prefix taşınır ya çakışılır. Koşulsuz prefix'i reddetme kararı veriyi doğru okuyordu: 718 endpoint'in %99.4'ü prefix'siz benzersiz. Ama kalan %0.6 host'a kod değişikliği dayatıyor, yani her yeni backend aynı duvara çarpar.

**Düzeltme (uygulandı, aşağıdaki bölüm):** çakışmada deterministik ayrıştırma — çakışan **her iki** tarafa container'dan türetilmiş prefix eklenir (`notification_delete` + `push_provider_config_delete`), `name_disambiguated` uyarısı üretilir, prefix'ten sonra da çakışma varsa fatal kalır. Bu "sessiz çözüm yasak" kuralını bozmaz: kural agent'ın yanlış tool'u seçmesine yol açan görünmez düzeltmeyi (`delete_2` gibi anlamsız sonek) yasaklıyordu; container prefix'i hem uyarı üretir hem agent'a gerçek ayrımı verir. Tek tarafa eklemek asimetrik ve keyfi olurdu.

**İkinci bulgu: framework anonimliği bu backend'de yanlış pozitif.** 698 tool'un tamamı `anonymous: true` çıktı, çünkü hiçbir endpoint `IAuthorizeData` taşımıyor ve fallback policy yok — T0 kuralının harfi. Gerçekte hepsini `JwtAuthenticationMiddleware` koruyor. 447'si `imperative` olduğu için görünürlük onları `unknown` bırakıp probe'a gönderiyor (doğru), ama kalan ~250 tool `allow` görünüyor: kimliksiz bir çağıran onları listede görür ve invoke'da 401 alır. Yaptırım açığı değil, liste kirliliği. **Düzeltildi (aşağıdaki bölüm):** çözüm host beyanı değil, kuralın kendisiydi — anonimlik üç değerli yapıldı, beyansız durum `unknown` oldu ve probe'a devredildi. Host'a knob eklenmedi.

### Container prefix'i: çakışma duvarı kaldırıldı (2026-09-02)

Yukarıdaki soruşturmanın sonucu spec değişikliğine çevrildi. Tool adı artık `{prefix}_{gövde}`; prefix operasyon kimliğinin zaten parçası olan `container`'dan gelir. Mod default `Always` (kullanıcı kararı: agent'ın okuduğu isim uzayı tutarlı olsun), `OnCollision` seçilebilir.

Prefix çözümü en özelden genele, seçim hiyerarşisinin aynı deseni: operasyon tam ad beyanı (`[McpTool(Name = ...)]`) → prefix beyanı (`[McpTool(Prefix = ...)]`, container veya operasyon) → host global kuralı (`options.Naming.Prefix`) → container adından türetme (son segment, `Controller` soneki atılır, snake_case). Platform ilk üçünü toplayıp saf katmana iki alan olarak indirir: `toolName` ve `containerPrefix` ([metadata-contract.md](../../../packages/spec/metadata-contract.md)). Böylece türetme ve bastırma saf, fixture'lanabilir kalır.

**Tekrar bastırma** olmasa kural okunamaz isimler üretirdi: `SupportRequestController.CreateSupportRequest` → `support_request_create_support_request`. Prefix'in token dizisi gövdede ardışık geçiyorsa eklenmez; karşılaştırmada arama semantiğinin sondaki `s` katlaması kullanılır, böylece `OrdersController.GetOrder` → `get_order` kalır. Katlama bilinçli olarak `ies`/`y` çiftini kapsamaz (`TaskActivitiesController.SaveTaskActivity` → `task_activities_save_task_activity`); aksi halde SDK dil morfolojisi motoruna dönüşür ve düzensiz çoğullarda yine durur. Fixture'landı.

**Gerçek backend doğrulaması.** motokurye'de eklenen 5 `[EndpointName]` **geri alındı** ve yeniden ölçüldü: 718 keşif, 698 tool, **0 `name_collision`**. Yani prefix kuralı, dört çakışmayı host'a tek satır yazdırmadan çözüyor — önerinin asıl vaadi buydu. Adlar `bpm_validate_definition`, `push_provider_config_list` gibi container'ını taşıyor. Maliyet ölçüldü: tek bir `long_tool_name` uyarısı (66 karakter), yani prefix uzunluk tavanını 698 adın birinde zorluyor. Kabul edilebilir, çünkü tavan uyarı seviyesinde.

Korpus 53 → 60 fixture (naming 7 → 12, `same-name-different-container-collides` → `...-disambiguates` olarak yeniden yazıldı). Core TS 60/60, C# fixture koşucusu 5/5, V matrisi 20/20, M matrisi 10/10, üç TFM build yeşil. `VisibilityController` test host'unda `[McpTool(Prefix = "vis")]` ile işaretlendi: bastırma sayesinde 20 testin beklediği adlar korundu ve prefix beyanı da dolaylı doğrulandı.

### Anonimlik üç değerli oldu (2026-09-02)

Yukarıda "ikinci bulgu" olarak yazılan yanlış pozitif düzeltildi. `auth.anonymous` artık `boolean` değil `yes | no | unknown`:

| Endpoint metadata'sı                      | Değer     | Neden                                    |
| ----------------------------------------- | --------- | ---------------------------------------- |
| `IAllowAnonymous` var                     | `yes`     | Kesin: framework kimlik aramadan geçirir |
| `IAuthorizeData` veya fallback policy var | `no`      | Kesin: framework kimlik arar             |
| Hiçbiri yok                               | `unknown` | Bilgi yok                                |

Eski kural üçüncü satırı `true` sayıyordu ve gerekçesi framework'ün kendi davranışıydı: `[Authorize]`'sız, fallback'siz bir endpoint'i authorization middleware hiç değerlendirmez. Bu doğru ama dar bir gerçek — yalnız **framework'ün authorization katmanı** hakkında konuşuyor, "bu endpoint'i hiçbir şey engellemez" demiyor. **Middleware endpoint metadata'sına yazmaz, yalnız okur:** `app.UseMiddleware<...>()` bir endpoint'e değil pipeline'a bağlanır, dolayısıyla "beni şu middleware koruyor" diye bir işaret hiç oluşmaz. Kimliği global middleware'de kuran backend'de metadata'da sadece negatif işaret (anonim muafiyeti) bulunur.

Kural değişince görünürlük sıralaması yediye çıktı (`anonymous == unknown → unknown`, imperatif kontrolünden hemen sonra). `unknown` probe'a devrediliyor ve probe custom middleware'in 401'ini **bayrak işaretlenmeden** okuyup `deny` diyor — bu davranış zaten vardı (V18), artık kapsamı genişledi.

**Gerçek backend ölçümü, öncesi ve sonrası.** motokurye'de 698 tool:

|                                    | Eski kural             | Yeni kural |
| ---------------------------------- | ---------------------- | ---------- |
| `yes` (kesin anonim)               | 698                    | 34         |
| `no` (kesin korumalı)              | 0                      | 0          |
| `unknown`                          | 0                      | 664        |
| Probe'a giden                      | 447 (yalnız imperatif) | 664        |
| Kimliksiz çağırana `allow` görünen | 251                    | 34         |

34 sayısı host'un tek satırlık `AllowAnonymousAttribute : IAllowAnonymous` değişikliğinin karşılığı: o endpoint'ler artık kesin bilgiyle işaretli. Yeni probe adayı 217 endpoint (664 eksi zaten imperatif olan 447). Probe bütçesi top-K olduğu için maliyet arama başına sabit kalıyor.

**Ödenen bedel dürüst.** Yetki beyanı taşımayan minimal API / route handler'lar probe edilemiyor (kesme noktası yok) ve `unknown` kalıp `authUncertain` ile gösteriliyor. Çıkış yolu SDK'ya değil framework'e yazılan tek satır: `.AllowAnonymous()`. DemoApi'nin `/health` endpoint'i bu yüzden güncellendi. Deklaratif yazan backend hiçbir maliyet ödemiyor.

C# tip üreticisi bu tur string enum desteği kazandı (`$defs` içindeki `type: string` + `enum` → C# `enum`); `JsonStringEnumConverter` + camelCase ile tel biçimi korunuyor. V matrisi 20 → 22: V22 beyansız endpoint'in `unknown` kaldığını, V23 probe açıkken aynı endpoint'in kimlikli çağırana görünüp kimliksize görünmediğini sabitliyor — motokurye'nin JWT middleware deseninin minyatürü. Korpus 60 → 63. Core TS 63/63, C# 30/30, üç TFM yeşil.

### Probe maliyeti: ölçüm ve üç ayar (2026-09-02)

Anonimlik kuralı değişince canlı ölçüm bir gerileme gösterdi: 50 kartlık arama **21.978 ms** sürdü (eski kuralda 1.180 ms). Sebep dürüst: eskiden 251 endpoint `allow` çıkıp probe'a hiç girmiyordu, artık `unknown` ve ilk 25'i gerçekten koşuyor. Kartların ilk 25'i çözülmüş, 26'ncıdan sonrası `authUncertain` — yani bütçe kuralı doğru çalışıyor, sorun bütçe içindeki her probe'un pahalı olması.

**Yanlış teşhis, düzeltmesiyle.** İlk açıklamam "host `IsSkMcpRequest()` ile `TouchLastPing`'i atlasın" idi; koda bakınca yanlış çıktı. `TouchLastPing` kendi içinde throttle'lı (`_lastPingCache`), 25 probe'un 24'ü zaten veritabanına gitmiyor. Asıl yük [JwtAuthenticationMiddleware.cs:167](../../../../motokurye/SystemSoftBaseServerService/Middleware/JwtAuthenticationMiddleware.cs#L167): her istekte yeni NHibernate oturumu açılıp kullanıcı çekiliyor, önbellek yok. Ve bu **atlanamaz**, çünkü probe'un cevabı ona bağlı — yetki filtreleri kullanıcı bağlamını okuyor. Host tarafında geçerli kalan tek dal gerçek yan etkiler (`LogDenial`, erişim logu): performans için değil, veri kirliliği için.

**Karar: maliyet politikası host'undur, SDK ayar sunar.** Doğru cevap backend'e göre değişiyor (veritabanı yükü, rate limiter, kabul edilebilir gecikme) — karar 003 cetvelinin tam tanımı. Üç ayar:

| Ayar                   | Default | Ne yapar                                          |
| ---------------------- | ------- | ------------------------------------------------- |
| `ProbeTopK`            | 25      | Sıralama sonrası kaç aday probe edilir            |
| `ProbeConcurrency`     | 4       | Kaç probe aynı anda koşar (1 = sıralı)            |
| `ProbeCacheLifetime`   | 30 sn   | Çağıran-kapsamlı sonuç önbelleği (sıfır = kapalı) |
| `ProbeCacheMaxCallers` | 128     | Önbellekte tutulan çağıran sayısı tavanı          |

Kendine güvenen host `ProbeTopK = 250` yazar, rate limiter'ı hassas olan `ProbeConcurrency = 1` yapar, yetki değişiminin anında yansımasını isteyen önbelleği kapatır.

**Önbellek anahtarı** kimlik taşıyıcılarının değerlerinin SHA-256 özeti + tool adıdır. Gerekçe: taşıyıcılar sentetik kimliğin tamamıdır, aynı taşıyıcılar aynı verdict'i üretir; farklı çağıran farklı anahtar alır (V24 bob ile bunu sabitliyor). Özet kullanılıyor ki token bellekte düz metin durmasın. Bilinçli sınır: `Identity.Project` dış istek dışında bir kaynaktan değer türetiyorsa anahtar onu görmez, öyle bir kurulumda önbellek kapatılmalı — spec'e yazıldı.

**Önbellek yapısı (Redis pratiklerinden alınan iki düzeltme).** İlk sürüm düz bir `anahtar → (karar, son kullanma)` sözlüğüydü ve iki kusuru vardı. Birincisi sınırsız büyüme: süresi dolan giriş yalnız tekrar okunduğunda siliniyordu, bir daha aranmayan çağıranın kayıtları sonsuza kadar kalıyordu (698 tool × N çağıran). İkincisi yanlış kırılım: her tool ayrı bir girişti, dolayısıyla bir çağıranın kararlarını topluca atmak 698 anahtar taramak demekti. Düzeltme, kayıtları **çağıran başına gruplamak**: tek son kullanma tarihi, tek sözlük, ve `ProbeCacheMaxCallers` (default 128) ile en-az-kullanılan çağıranı düşüren bir kapasite sınırı. Redis'in kendisi SDK'ya girmedi — kütüphaneye altyapı bağımlılığı eklemek backend-agnostic kuralını bozar; çok instance'lı kurulum için bir depo soyutlaması gerekirse talep kanıtlandığında eklenir.

**Eşzamanlılık hatası, test yakaladı.** V26 (kapasite sınırı) ilk yazımda kırıldı: LRU damgası `AddOrUpdate` fabrikasında değil, sonrasında yazılıyordu; paralel probe'larda yeni giriş damgası sıfırken buduma turuna yakalanıp hemen atılabiliyordu. Damga artık giriş oluşturulurken atanıyor.

**Test harness'ında AsyncLocal tuzağı.** Aynı testte iki farklı çağıran kurarken `new HttpContextAccessor { HttpContext = outer }` kullanmak yanılttı: .NET'in `HttpContextAccessor`'ı **AsyncLocal tabanlıdır**, yani her yeni örnek aynı ambient depoya yazar ve ikinci çağıran birincinin bağlamını ezer. Trace çıkardığında alice'in üçüncü aramada bob'un anahtarını ürettiği görüldü. SDK'nın kusuru değil — gerçek kullanımda her istek kendi akışında koşar — ama test sabit bir `IHttpContextAccessor` uygulamasına geçirildi. Çok kimlikli her test bundan sonra o yolu kullanmalı.

Arama döngüsü de yeniden yazıldı: önce sıralama ve karar toplama, sonra probe kuyruğunun `SemaphoreSlim` ile sınırlı eşzamanlılıkta koşması, sonra kart üretimi. V matrisi 22 → 25: V24 aynı çağıranın ikinci aramasında probe koşmadığını ve farklı çağıranın koştuğunu, V25 önbellek kapalıyken her aramanın probe ettiğini, V26 kapasite sınırında en-az-kullanılan çağıranın düşürüldüğünü sabitliyor.

## Ertelenenler

- Şema sadeleştirme (generic wrapper soyma, derinlik, recursion `$ref`, readonly düşme) → adım 6. Property naming policy adım 3'te çözüldü; Newtonsoft host'lar için hook beyanı gerekiyor.
- Üç TFM test matrisi + gerçek boot ile uçtan uca → adım 7. motokurye branch'inde gereken host değişiklikleri: `AllowAnonymousAttribute : IAllowAnonymous`, 4 endpoint'e `[EndpointName]`, tarayıcıya özgü dönüşümlerde `IsSkMcpRequest()` dalı (`EncryptedJson*Formatter` — kanıtlandı; `RequestLoggingMiddleware`, rate limiter, `LogDenial` — veri kirliliği için). `x-portalcode` ve `x-enrollment` gerekmiyor — ölçüldü.
- Bağlantı yansıtması (M8) ve sentetik istek işareti (M9) NestJS'te aynalanmadı — Express karşılıkları `socket.remoteAddress` ve `req[Symbol]`/`res.locals`. n=2 kuralı gereği kural henüz tek implementasyonda.
