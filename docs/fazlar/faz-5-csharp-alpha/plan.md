# Faz 5 — C# SDK Sertleştirme + Public Alpha

Durum: **devam ediyor** — bkz. [notlar.md](notlar.md).

## Hedef

SDK #1'i gerçekten kurulabilir bir paket haline getirmek ve public API yüzeyini alpha öncesi sabitlemek. Bu fazın kanıtı bir demo değil, **gerçek bir backend**: paket yerel bir nupkg beslemesinden büyük bir üretim backend'ine (motokurye, 718 endpoint) kuruluyor ve orada koşuyor.

Kırıcı değişiklikler için pencere bu fazdır. Alpha'dan sonra public yüzeyi değiştirmenin maliyeti tüketiciye çıkar.

## Somut çıktılar

- **Paketleme**: `SkMcp.AspNetCore` `0.1.0-alpha.1` — `Directory.Build.props` + merkezî paket sürümü (CPM), MIT lisans ifadesi, SourceLink + snupkg sembolleri, deterministik build. `dotnet pack` → `local/nupkg-feed/`. nuget.org'a yayın **yok**.
- **TFM daraltma**: `net8.0;net9.0;net10.0` → `net8.0;net10.0`. Test projesi de çok hedefli; net8 ilk kez gerçekten koşuluyor.
- **Public yüzeyin kapatılması**: iç tesisat `internal` + `InternalsVisibleTo(SkMcp.Tests)`. Public kalan: giriş noktaları, `SkMcpOptions` ağacı, `[McpTool]`/`[McpIgnore]`, [karar 006](../../kararlar/006-genisletme-noktalari.md)'nın genişletme noktaları ve bunların imzalarından erişilebilen tipler.
- **Kök namespace temizliği**: istek kompozisyonu tipleri `SkMcp.AspNetCore.Requests` altına. Swashbuckle kullanan host'ta `using SkMcp.AspNetCore;` artık `CS0104` vermiyor.
- **Bağlama guard'ı**: `UseSkMcpCapture()` çağrılmadan `MapSkMcp()` startup'ta hata fırlatır. Sessiz kırılma yerine gürültülü, erken hata.
- **Dokümanlar**: [sdks/dotnet/README.md](../../../sdks/dotnet/README.md) (quickstart), kök README (create-turbo şablonu gitti), [gercek-backend-entegrasyonu.md](../../gercek-backend-entegrasyonu.md).
- **Versiyonlama politikası**: [karar 010](../../kararlar/010-versiyonlama-politikasi.md). Spec `0.1.0`, üretilen `SkMcpSpec.Version` sabiti.
- **CI**: `.github/workflows/ci.yml` — build/lint/check-types/validate + `dotnet test` (net8.0 + net10.0) + `pack` artefaktı. Conformance suite kapı.

## Bitti kriteri

- İç yapıyı hiç bilmeyen bir geliştirici, yalnızca README ile, temiz bir projede `search_tools`'u ~15 dakikada çalıştırabiliyor. (Kronometreyle, kör test.)
- Paket yerel beslemeden motokurye'ye kuruluyor ve orada `smoke` + `error-envelope` senaryoları koşuyor.
- CI yeşil; conformance suite zorunlu kapı.

## Faz 4 planından devralınan açık soruların çözümü

Bu dört soru, faz planı repo neredeyse boşken yazıldığında açıktı. Dördü de kapatıldı:

1. **Semver politikası.** Spec kendi sürümünü taşır, SDK hangi spec'i implement ettiğini beyan eder. Ayrıntı ve gerekçe [karar 010](../../kararlar/010-versiyonlama-politikasi.md)'da. Spec v1.0 tag'i **Faz 6 sonuna** ertelendi.
2. **Minimum .NET sürümü.** `net8.0` + `net10.0`. net9 non-LTS ve bu ortamda runtime'ı bile kurulu değil. net8 pazarlık konusu değil: hedef backend `global.json` ile SDK 8.0.0 pinliyor.
3. **DemoApi bir `dotnet new` template'ine dönüşür mü?** Hayır, alpha dışı. Template bakımı olan ayrı bir artefakttır ve README bütçesine katkısı yok.
4. **NuGet prefix / npm scope rezervasyonu.** Ertelendi. Rezervasyon ancak gerçek bir registry yayını planlanınca anlam taşır; alpha yerel besleme.

## Bilinçli olarak alpha dışı

- nuget.org / npm yayını, prefix ve scope rezervasyonu.
- `dotnet new` template'i.
- Spec v1.0 tag'i.
- `schema-simplification/` fixture korpusu ve generic wrapper soyma / derinlik-inline / `$ref` recursion kuralları. Bunlar [sema-donusum-kurallari.md](../../../packages/spec/sema-donusum-kurallari.md)'nin kendi "Pinlenmemiş alanlar" bölümünde açıkça tanımsız bırakılmıştır; alpha bunları çözmez, dürüstçe işaretli tutar.
- İkinci örnek proje. Eski planın gerekçesi "farklı auth kurulumuyla sözleşmenin genelliğini göstermek"ti; `OrdersController` zaten policy, rol, imperatif sahiplik kontrolü ve anonim endpoint'i bir arada gösteriyor. Asıl genellik sınavı motokurye: `AddAuthentication` hiç yok, kimlik elle yazılmış middleware'de.
- Dağıtık `ISkMcpCache` adaptörü (Faz 4'te ertelendi, hâlâ geçerli).
- `MotokuryeCallerScopeResolver` ve `PermissionService` → `InvalidateTagAsync` köprüsü — host kodu, bu deponun kapsamı değil. Nasıl yazılacağı [gercek-backend-entegrasyonu.md](../../gercek-backend-entegrasyonu.md)'de anlatılır.
- `sdks/nestjs`, `packages/core`, `packages/spec`, `packages/conformance` README'leri.
