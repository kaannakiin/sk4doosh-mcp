# Faz 5 — Notlar

Tarih: 2026-09-03. Kapsam: paketleme, TFM daraltma, public yüzeyin kapatılması, kök namespace temizliği, bağlama guard'ı, CI, dokümanlar. Kalan: motokurye'ye kurulum ve orada koşum; README'nin 15 dakika bütçesinin kör testi.

## Açık soruların cevapları

**Semver: spec ile SDK bağlı mı bağımsız mı?** Bağımsız — [karar 010](../../kararlar/010-versiyonlama-politikasi.md). Spec `packages/spec/package.json`'da `0.1.0`; `generate-types.mjs` bunu okuyup `Generated/Spec.cs`'e `SkMcpSpec.Version` sabiti üretiyor. Elle yazılan ikinci bir sürüm dizesi yok. SDK `0.1.0-alpha.1`.

**Minimum .NET sürümü.** `net8.0` + `net10.0`. net9 düştü: non-LTS ve bu makinede runtime'ı bile kurulu değil (`dotnet --list-runtimes` yalnız 8.0.30 ve 10.0.11 gösteriyor), yani üç hedefli build'in net9 ayağı hiçbir zaman koşulmamıştı. net8 pazarlık dışı — motokurye `global.json` ile SDK 8.0.0 pinliyor.

**`dotnet new` template'i.** Hayır. Ayrı bakım yükü, README bütçesine katkısı yok.

**Prefix / scope rezervasyonu.** Ertelendi; gerçek registry yayını planlanınca anlamlı.

## Alınan kararlar

**Public yüzey alpha'dan önce kapatıldı.** ~70 top-level public tipin çoğu iç tesisattı (`PipelineHolder`, `SkMcpDispatcher`, `SkMcpCatalogProvider`, `ToolIndex`, `SyntheticRequestFactory`, `JsonSchemaMapper`, …). Hepsi `internal` + `InternalsVisibleTo("SkMcp.Tests")`. Kırıcı pencere alpha'dan önceydi; sonrasında maliyeti tüketiciye çıkardı.

Public kalanlar üç gruptan geliyor: giriş noktaları (`AddSkMcp`/`UseSkMcpCapture`/`MapSkMcp`, `SkMcpOptions` ağacı, `[McpTool]`/`[McpIgnore]`, `IsSkMcpRequest()`, sk-mcp istisnaları), [karar 006](../../kararlar/006-genisletme-noktalari.md)'nın altı genişletme noktası + iki giriş noktası, ve **bu arayüzlerin imzalarından erişilebildiği için zorunlu olarak public kalanlar**. Son grup baştan öngörülmedi, derleyici gösterdi: `IProbeEvaluator.CanProbe(CatalogEntry)` → `CatalogEntry` public → `CatalogEntry.Template` tipi `RequestTemplate` → `RequestTemplate` ve üyeleri (`ParameterBinding`, `ParameterLocation`, `ParameterKind`) transitif olarak public. Aynı şekilde `CallerScope`, `CacheKey`, `CacheKind`, `CallerFacts`, `VisibilityDecision`, `CallerIdentity`, `InvokeOutcome` ailesi, `BackendResponse` ailesi.

**Kök namespace temizliği aynı commit'te.** Faz 3'te motokurye'de ölçülen `CS0104` (`ParameterLocation`, `Microsoft.OpenApi.Models` ile çakışıyordu, host `Program.cs:220`'de patlamıştı) burada kalıcı çözüldü: `RequestTemplate.cs` ve `RequestComposer.cs` → `SkMcp.AspNetCore.Requests`. Geri kalan çakışma adayları zaten `internal` olduğu için host'un `using SkMcp.AspNetCore;` satırından görünmüyor. Kökte kalan 19 public tipin 17'si `SkMcp` önekli ya da `*Options`; kalan ikisi option ağacının enum'ları: `UnknownVisibility` ve `VisibilityTier` ([SkMcpOptions.cs:56-58](../../../sdks/dotnet/src/SkMcp.AspNetCore/SkMcpOptions.cs)).

Kalan risk kayda geçsin: `CacheOptions`, `SchemaOptions`, `SelectionOptions` gibi option sınıfları ve yukarıdaki iki enum kökte, jenerik adlar. Pratikte ad olarak yazılmıyorlar (host `options => options.Cache.Lifetime = ...` lambda'sı kuruyor), o yüzden çakışma olasılığı düşük; yine de aynı adı taşıyan bir host tipiyle `CS0104` üretebilirler. Ölçülmüş bir vaka yok, ölçülene kadar taşınmadı.

**İkinci örnek proje yapılmadı.** Eski plan "farklı auth kurulumu — ör. policy yerine role bazlı" diyordu. `OrdersController` zaten `[Authorize(Roles = "admin")]`, claim tabanlı policy, assertion tabanlı policy, imperatif `Forbid()` sahiplik kontrolü ve `[AllowAnonymous]`'ı bir arada gösteriyor. İkinci bir oyuncak projenin kanıtlayacağı bir şey yok; asıl genellik sınavı motokurye, çünkü orada `AddAuthentication` hiç yok ve kimlik elle yazılmış middleware'de.

**Test matrisi tek job, TFM başına ayrı job değil.** `dotnet test` çok hedefli projeyi tek çağrıda iki TFM için de koşuyor ve çıktıyı `(net8.0)` / `(net10.0)` diye etiketliyor. Matrix her ayakta iki SDK'yı yeniden kurdurup aynı kapsamı iki katı sürede verirdi.

## Sürprizler

**Spec, kapattığım bir sınıfın public kalmasını şart koşuyordu.** `CarrierHashCallerScopeResolver`'ı `internal` yaptım, testler geçti (`InternalsVisibleTo` var), derleme temizdi — ama [onbellek.md:22](../../../packages/spec/onbellek.md) normatif olarak "Bu digest girdisi (`DigestInput`) hem C# hem TS'te public ve saftır — host onu sarıp kendi tag'ini ekleyebilir" diyor. Tam da motokurye'nin bekleyen işi (`MotokuryeCallerScopeResolver`) bunu sarmalamayı gerektiriyor. Geri alındı.

Ders: public yüzeyi kapatırken derleyici ve test suite yetmiyor; spec metnini de taramak gerekiyor. `packages/spec/*.md` içinde "public" geçen tek başka yer `tasima.md`'deki `Cache-Control: public` — o alakasız.

**Aynı hatanın ikincisi: `SkMcpCatalogProvider.ReloadAsync`.** Kapatma turundan sonra yapılan çok ajanlı denetim, `DigestInput` ile birebir aynı sınıftan ikinci bir ihlal buldu — [karar 006:31](../../kararlar/006-genisletme-noktalari.md) `SkMcpCatalogProvider.ReloadAsync`'i "host çağırır" giriş noktası olarak sayıyor, [onbellek.md:53](../../../packages/spec/onbellek.md) ve [tasima.md:32](../../../packages/spec/tasima.md) da ona atıf yapıyor; ama sınıf `internal` olunca dışarıdan çağrılamaz hale geldi. Derleme temizdi, 154 test geçiyordu — çünkü testler `InternalsVisibleTo` ile içeriden görüyor. Yeşil kapıların hiçbiri bunu yakalayamaz.

Çözüm sınıfı public'e döndürmek olmadı: aynı kararın "sealed kalanlar" listesi `SkMcpCatalogProvider`'ı zaten sayıyor ve sınıfın `Attach`/`Find`/`Search`/`WarmUp`/`EnsureValid` gibi 11 public üyesi var — host'un hiçbirini çağırmaması gerekiyor. `ReloadAsync` zaten public ve DI'da kayıtlı olan `ISkMcpCatalogChangeSource`'a taşındı. Giriş noktası arayüzde, tesisat sınıfta. Üç doküman güncellendi; `CatalogReload_IsReachableThroughPublicChangeSource` testi erişilebilirliği sabitliyor.

Genelleme: bir tipi `internal` yaparken "testler geçiyor" hiçbir şey kanıtlamıyor. Kontrol listesi spec metni + karar dokümanları + dışarıdan erişim senaryosu olmalı.

**`ProjectReference` yerine paket zorunluluğu doğrulandı.** Yerel besleme akışı gerçekten kuruldu; `dotnet pack` bir `.nupkg` + bir `.snupkg` üretiyor, içinde `lib/net8.0` ve `lib/net10.0`, README, MIT lisans ifadesi ve SourceLink commit metadata'sı var. Çözüm bazında `dotnet pack` yalnız kütüphaneyi paketliyor; örnek projeler `IsPackable=false`.

**`0,/re/` adres biçimi BSD sed'de yok.** macOS'ta sessizce hiçbir şey yapmıyor, hata da vermiyor — birkaç düzenleme "uygulandı" sanılıp uygulanmamıştı. `perl -pi -e` ile yapıldı. Ayrıca `samples/DemoApi/DemoApi.csproj` CRLF satır sonlu (tek dosya böyle); `$` eşleşmesi `\r` yüzünden kaçıyordu.

**`SkMcpMetaTools` internal olabiliyor.** `AddMcpServer().WithTools<SkMcpMetaTools>()` reflection tabanlı; internal tipte kırılma riski derleyicinin yakalayamayacağı bir runtime riskiydi. Tam test suite iki TFM'de de geçti, kırılmıyor.

## Ölçüm ve doğrulama

- `dotnet test`: **154/154 net10.0, 154/154 net8.0**. net8 ayağı bu depoda ilk kez koşuldu (test projesi daha önce tek hedefliydi).
- `pnpm turbo run build check-types lint validate`: 20/20 görev başarılı — `dotnet format --verify-no-changes` ve conformance fixture doğrulaması dahil.
- `dotnet pack`: `SkMcp.AspNetCore.0.1.0-alpha.1.nupkg` + `.snupkg`.

Bekleyen: motokurye'ye kurulum, `smoke` + `error-envelope` koşusu, README'nin 15 dakika bütçesinin kronometreyle kör testi.

## Ertelenenler

- nuget.org / npm yayını, prefix ve scope rezervasyonu.
- Spec v1.0 tag'i → Faz 6 sonu ([karar 010](../../kararlar/010-versiyonlama-politikasi.md)).
- `schema-simplification/` fixture korpusu ve wrapper soyma / derinlik-inline / `$ref` recursion.
- Dağıtık `ISkMcpCache` adaptörü.
- `MotokuryeCallerScopeResolver` ve `PermissionService` → `InvalidateTagAsync` köprüsü (host tarafı iş).
- `sdks/nestjs`, `packages/core`, `packages/spec`, `packages/conformance` README'leri — bilinçli olarak yazılmadı, unutulmadı.
- Public API onay testi (`PublicAPI.Shipped.txt` / analyzer). Yüzey bu fazda elle sabitlendi; regresyonu derleme hatasına çeviren mekanizma henüz yok.
