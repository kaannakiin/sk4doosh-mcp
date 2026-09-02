# Karar 003 — Sentetik İstek Üstverisi

Tarih: 2026-08-28 (M8-M9: 2026-09-02). Durum: **kabul edildi, kodla kanıtlandı** (test matrisi M1-M7; M8-M9 V20 ile).

## Cetvel

Config kararlarının ölçüsü: **doğru cevap backend'den backend'e değişiyorsa politika → kod yazanın; tek doğru cevap varsa mekanik → SDK'nın, düğmesiz.** Ayrıca soru tipi config şeklini belirler: "hangi parçalar geçsin" → beyan listesi ([karar 001](001-kimlik-tasiyicilari.md)); "bu alan ne olsun" → düz property. Her yeni ayar bedava değildir: test çarpanı + döküman + NestJS eşleniği + fixture maliyeti taşır — knob talep kanıtlayınca eklenir.

## Kod yazanın yönettiği (`options.Synthetic`)

| Ayar              | Default                                                       | Neden politika                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Host` / `Scheme` | dış istekten yansıtılır; dış istek yoksa `localhost` / `http` | Host'a göre tenant seçen backend'lerde `localhost` **yanlış tenant** demektir (M1: tenant-by-host senaryosu); proxy arkasında sabit iç hostname isteyen kurulum da meşru (M3: override) |
| `Accept`          | `application/json`                                            | XML negotiation yapan backend değiştirebilir (M4)                                                                                                                                       |
| `UserAgent`       | `sk-mcp/{versiyon}`                                           | Audit loglarında kimlikli satır; değeri onların (M5)                                                                                                                                    |

Yansıtma, "kaynak her zaman dış istek, uydurma yok" değişmezinin uzantısıdır.

## SDK'nın düğmesiz taşıdıkları

- **Trace korelasyonu (M6):** dış isteğin `traceparent`/`tracestate` header'ları ve `TraceIdentifier`'ı sentetik isteğe her zaman taşınır — agent çağrısı ile tetiklediği iç istek loglarda eşleşir. Kapatma düğmesi yok: kapatan yalnız kendi audit'ini köreltir.
- **`Accept-Encoding` asla taşınmaz (M7):** dispatcher body'yi düz okur; compression devreye girerse kırılır. İç mekanik, config'e kapalı.
- **İstek kaynağı (M8):** dış isteğin bağlantı bilgisi (ASP.NET: `Connection.RemoteIpAddress`/`RemotePort`, `LocalIpAddress`/`LocalPort`) sentetik isteğe taşınır; dış istek yoksa boş kalır. Uydurulmaz — özellikle loopback yazılmaz: IP allowlist'i olan backend'de loopback yetki yükseltmesidir. Boş bırakmak da nötr değildi: motokurye'nin global rate limiter'ı partition anahtarını `RemoteIpAddress?.ToString() ?? "unknown"` ile kuruyor, yani tüm agent trafiği tek kovaya düşüp birbirini kilitliyordu. Platform karşılığı olmayan yerde kural bunu dayatmaz (karar 004'ün `TraceIdentifier` genellemesi).
- **Sentetik istek kendini tanıtır (M9):** istek bağlamında bir işaret taşınır (C#: `HttpContext.Items`, `IsSkMcpRequest()`), probe bayrağının kardeşi. Host tarayıcıya özgü dönüşümlerini (gövde şifreleme, compression, oturum dokunuşu, erişim logu, rate limit) bu işaretle atlayabilir. **`UserAgent` bu iş için kullanılamaz:** dış istek onu taklit edebilir, o yüzden gözlemlenebilirlik sinyalidir, güvenlik dalı değil. İşaret dışarıdan set edilemez (V17).

## Bilinçli eklenmeyen

Genel `Customize(outer, synthetic)` hook'u — `Identity.Project` kimlik kompozisyonu için yeterli; genel müdahale kancası talep kanıtlanmadan eklenmez (spec'i n=1'le yazma dersinin config hali).

Gövde/yanıt dönüşüm hook'ları (`TransformRequest`/`TransformResponse`) — motokurye'nin AES+gzip formatter'ları ilk gerçek talep gibi görünüyordu, ama sentetik istek hiç kablo görmez: gövde aynı process içinde `MemoryStream`. Şifrelemek sıfır güvenlik değeri, saf maliyet. Doğru cevap dönüşümü taklit etmek değil, **agent'ı ayrı bir client tipi olarak tanıtmak** (M9) — host tarayıcı varsayımını kendi kodunda atlar. Hook'lar ancak formatter'ına dokunamayan bir host çıkarsa açılır.

Backend'in `Authorization` dışında beklediği header'lar için ayrı mekanizma — MCP'nin tek standart kimlik kanalı `Authorization`'dır; tenant/portal header'ının karşılığı yok ve her client özel header göndermeye izin vermez. Bu yüzden çözüm client'tan istemek değil, host'un `Identity.Project` ile **türetmesi**: değer tokendan/kullanıcının default'undan/sabit kurulum değerinden çıkar. `Forward(name)` client'ın gönderdiği durum için zaten var; yeni ayar gerekmedi.

## NestJS doğrulaması (2026-08-28)

M1-M7 aynası 7/7 ([synthetic-metadata.spec.ts](../../sdks/nestjs/test/synthetic-metadata.spec.ts)). İki revizyon ([karar 004](004-nestjs-dogrulamasi.md)):

- **Scheme mekanizması platform-özgü:** ASP.NET'te `Request.Scheme` düz set edilir; Express'te `req.protocol` soketten türer — sentetik bağlamı SDK kurduğu için `socket.encrypted` ile temsil edilir, `x-forwarded-proto`/`trust proxy` gerekmez. Yansıtma kuralı (dış istek → sentetik) değişmedi.
- **Trace kuralı genellendi:** `traceparent`/`tracestate` her zaman taşınır; platform istek kimliği (ASP.NET `TraceIdentifier`) **varsa** taşınır — Express'te karşılığı yok, kural artık bunu dayatmaz.

## Request katmanı durumu

Adım 1 kimlik ([001](001-kimlik-tasiyicilari.md)) ✓ · Adım 2 argüman ([002](002-arguman-eslemesi.md)) ✓ · **Adım 3 üstveri ✓ (bu karar)** · Adım 1-3 NestJS'te ikinci kez doğrulandı ([004](004-nestjs-dogrulamasi.md)) · Kalan: adım 4 pipeline girişi/capture genelleştirmesi, adım 5 yaşam döngüsü (timeout/iptal).
