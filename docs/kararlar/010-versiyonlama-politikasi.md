# Karar 010 — Versiyonlama politikası

Tarih: 2026-09-03. Durum: **kabul edildi** — Faz 5 (C# public alpha) bu kararı takip eder.

## Spec ve SDK sürümleri ayrıdır

Spec kendi sürümünü taşır; her SDK "hangi spec sürümünü implement ettiğini" beyan eder. İkisi birlikte hareket etmez: SDK paketleme, hata düzeltmesi ya da API sertleştirmesi için sürüm atlarken spec hiç değişmeyebilir; spec bir kural pinlediğinde de her SDK'nın aynı anda sürüm atlaması gerekmez.

Tek kaynak korunur: sürüm `packages/spec/package.json`'da yaşar, kod üreticisi onu okur, üretilen dosyaya sabit olarak yazar. Elle bakımı yapılan ikinci bir sürüm dizesi yoktur.

- `packages/spec` → `0.1.0`, `private: true`. npm'e yayınlanmaz; sürüm bir işaretçidir, dağıtılabilir bir artefakt değil.
- `sdks/dotnet/scripts/generate-types.mjs` bu sürümü okur ve `Generated/Spec.cs` içine `SkMcpSpec.Version` sabitini üretir.
- `SkMcp.AspNetCore` paketi `0.1.0-alpha.1` ile başlar. Bu sürüm spec sürümünden bağımsızdır; ikisi yalnız `SkMcpSpec.Version` sabitinde buluşur.

## Spec v1.0 tag'i Faz 6 sonuna ertelendi

Faz 5 planının ilk hali "bu fazın sonunda spec v1.0 olarak tag'lenir" diyordu. O cümle, fazın kapsamının "nuget.org'a publish + prefix rezervasyonu" olduğu varsayımıyla yazılmıştı. Kapsam artık yerel nupkg beslemesi; dışarıya bir kararlılık sözü verilmiyor.

v1.0 semver'de geri uyumluluk taahhüdüdür. Şu an iki gerekçeyle erken:

- [sema-donusum-kurallari.md](../../packages/spec/sema-donusum-kurallari.md)'nin kendi "Pinlenmemiş alanlar" bölümü üç alanı açıkça tanımsız bırakıyor: generic wrapper soyma, derinlik sınırında inline'lama, `$ref` ile recursion kırma.
- Spec'in taşınabilirliği henüz **tek** implementasyonla sınandı. Faz 6'da NestJS keşif/arama/görünürlük aynı fixture korpusuna karşı geçtiğinde spec gerçekten iki bağımsız implementasyon tarafından doğrulanmış olur — v1.0'ın anlamlı olduğu eşik budur.

Karar: `spec-v1.0` tag'i **Faz 6 sonunda** kesilir. Alpha döneminde spec 0.x olarak kalır.

SDK milestone'ları için `sdk-dotnet-v0.1.0-alpha.1` gibi hafif tag'ler serbesttir; bunlar spec hakkında hiçbir taahhüt içermez.

## Reddedilen alternatifler

- **Tek birleşik sürüm (spec ve SDK'lar aynı numarayı taşır).** İki SDK farklı hızda ilerliyor: dotnet Faz 4'ü bitirmiş, NestJS'in keşif katmanı henüz yok. Ortak numara ya NestJS'i olmadığı bir olgunlukta gösterir ya da dotnet'i gerçekte geçtiği aşamalarda geri tutar. Ayrıca paketleme düzeltmesi için sürüm atlamak spec'i de oynatmak zorunda kalırdı.
- **Spec sürümünü `$id`'lere gömmek** (`tool-definition-v1.schema.json` gibi). Repo kuralı `$id` ≡ dosya adı; sürümü oraya taşımak her spec artışında tüm şema dosyalarının yeniden adlandırılmasını ve üreticinin `$ref` çözümünün değişmesini gerektirirdi. Sürüm tek bir yerde (`package.json`) tutulup üretilen koda taşınıyor.
- **`SkMcpSpec.Version`'ı elle yazmak.** İki kaynak demek, kaçınılmaz olarak birbirinden kopmaları demek. Üretici zaten şemaları okuyor; sürümü de oradan taşımak ek maliyet getirmiyor.
