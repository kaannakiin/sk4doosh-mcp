# Faz 5 — C# SDK Sertleştirme + Public Alpha

## Hedef

SDK #1'i gerçek, kurulabilir bir paket olarak yayınlamak ve conformance suite'ini geri dönülmez bir CI kapısı haline getirmek. Bu fazın sonunda spec v1.0 olarak tag'lenir — Faz 6 (NestJS) bu tag'e karşı yazılır.

## Somut çıktılar

- NuGet paketleme: `SkMcp.AspNetCore` paket metadata'sı, versiyonlama, symbol/source link.
- Quickstart README: sıfırdan `services.AddSkMcp()` + `app.MapSkMcp("/mcp")` → çalışan `search_tools`.
- DemoApi dışında ikinci bir örnek (farklı auth kurulumu — ör. policy yerine role bazlı — sözleşmenin genelliğini gösterir).
- CI: her push'ta `dotnet test` tam conformance suite'ini koşar; fixture'lara dokunan her değişiklik SDK testinden geçmeden merge edilemez.
- Spec v1.0 tag'i.

## Bitti kriteri

- İç yapıyı hiç bilmeyen bir geliştirici, yalnızca README ile, temiz bir projede `search_tools`'u makul bir sürede (kendimize koyduğumuz bütçe: ~15 dk) çalıştırabiliyor.
- CI yeşil; conformance suite kapı olarak zorunlu.

## Bu fazda çözülecek açık sorular

- Semver politikası: spec ile SDK versiyonları bağlı mı bağımsız mı? (eğilim: spec kendi versiyonunu taşır, SDK "spec X'i implement eder" beyan eder)
- Desteklenen minimum .NET sürümü (LTS hedefi: .NET 8 mi, güncel mi?).
- DemoApi yapısı bir `dotnet new` template'ine dönüşür mü, yoksa sadece örnek mi kalır?
- Paket adı/prefix rezervasyonu (nuget.org prefix reservation) ve `@sk-mcp` npm scope kaydı bu fazda mı alınır?
