# Karar 001 — Identity Carriers (Kimlik Taşıyıcıları)

Tarih: 2026-08-28. Durum: **kabul edildi, kodla kanıtlandı** ([SkMcp.AspNetCore](../../sdks/dotnet/src/SkMcp.AspNetCore/), test matrisi S1-S9 → 14/14).

## Karar

Sentetik isteğe kimliğin nasıl bineceğini SDK dayatmaz; backend geliştiricisi **beyan eder**:

```csharp
services.AddSkMcp(options =>
{
    options.Identity.Forward("Cookie");          // default zaten "Authorization"
    options.Identity.Forward("X-CSRF-Token");
    options.Identity.Project((outer, synthetic) => { /* tam kontrol */ });
});
```

- `Forward(name)`: dış istekteki header aynen sentetik isteğe yansır (Cookie dahil — cookie'ler header'dır).
- `Project(...)`: egzotik kombinasyonlar için kaçış kapısı; Forward listesinden sonra koşar.

## İki değişmez (bunlar pazarlıksız)

1. **Default-deny.** Beyan edilmeyen hiçbir şey geçmez; default yalnız `Authorization`. Körlemesine kopyalama spoofing kapısıdır (`X-Forwarded-For`, `Host`...).
2. **Kaynak her zaman dış istek; kimliği daima backend çözer.** SDK değer uydurmaz (S6: dış istekte olmayan carrier sentetiğe eklenmez — boş string bile değil). Kimlik çözümü her çağrıda backend'in kendi authentication'ında gerçekleşir.

## Neden principal-copy öldü

Faz 1'de standart JwtBearer dünyasında çözülmüş `ClaimsPrincipal`'ı kopyalamak çalıştı (`NoResult` inceliği sayesinde). Motokurye bunu kırdı: o backend `context.User`'ı hiç set etmiyor, kimlik custom middleware + ambient context'lerle kuruluyor. İki mod taşımak = spec'te iki dal, SDK'da iki yol, testte iki matris. Tek kural (header forwarding) her iki dünyada da çalışıyor ve "kimliği biz çözmeyiz" ilkesiyle birebir.

## Senaryolar bu modelde

- **CSRF:** cookie + antiforgery header çifti kullanan ikisini de beyan eder (S7); ya da agent yolunda antiforgery'yi kendisi muaf tutar — politika onun.
- **Cloudflare:** dış istek zaten CF'den geçti; `CF-Connecting-IP` vb. dış istekte mevcut — beyan eden taşır. Taşımak gerçeği taşımaktır, uydurma değil.
- **Custom kombinasyon:** `Project` (S5).

## Tradeoff

Her tool çağrısında kimlik yeniden doğrulanır. JWT'de bedava (mikrosaniye) ve artı güvenlik: session ortasında dolan token'ı otomatik yakalar (S8). Introspection tabanlı token'da her çağrı network demek — o gün geldiğinde kısa-TTL doğrulama cache'i meşru optimizasyon; şimdilik kapsam dışı not.

## Test kanıtı

[IdentityCarrierTests.cs](../../sdks/dotnet/tests/SkMcp.Tests/IdentityCarrierTests.cs): S1 token matrisi HTTP ile birebir (200/403/401), S2-S4 default-deny + beyan, S5 Project, S6 uydurma yasağı, S7 CSRF çifti, S8 expiry, S9 50 paralel dispatch'te kimlik sızması yok.

## NestJS doğrulaması (2026-08-28)

Model (`carriers`/`forward`/`clear`/`project`) TS'te birebir taşındı; S1-S9 aynası 9/9 ([identity-carriers.spec.ts](../../sdks/nestjs/test/identity-carriers.spec.ts)). Tek platform notu: Node header adlarını zaten lowercase verir, beyan lowercase'e normalize edilir. Kural değişikliği çıkmadı — iki bağımsız framework doğrulaması tamam ([karar 004](004-nestjs-dogrulamasi.md)).
