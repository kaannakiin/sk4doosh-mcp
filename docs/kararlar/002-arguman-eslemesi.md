# Karar 002 — Argüman Eşlemesi

Tarih: 2026-08-28. Durum: **kabul edildi, kodla kanıtlandı** ([RequestTemplate](../../sdks/dotnet/src/SkMcp.AspNetCore/RequestTemplate.cs) + [RequestComposer](../../sdks/dotnet/src/SkMcp.AspNetCore/RequestComposer.cs); test matrisi A1-A11, toplam süit 25/25).

## Karar

Agent'ın düz JSON argümanları deterministik algoritmayla HTTP isteğine dönüşür — normatif anlatım: [packages/spec/arguman-eslemesi.md](../../packages/spec/arguman-eslemesi.md). Dört ana kural:

1. **Encoding pazarlıksız.** Ham yapıştırma yok: path/query percent-encode, header değerinde CR/LF/NUL reddi. `"5/../admin"` tek encode'lu segment olur (A1: sentinel `/admin` endpoint'ine asla girilmedi); `"a&admin=true"` tek parametre değeri kalır (A2); header injection dispatch'e ulaşamadan ölür (A3).
2. **Validation backend'in; tek istisna path tip kapısı.** Semantik doğrulama backend'de çalışır. Path parametresinde tip uyuşmazlığı bizde hataya döner (A4) — aksi halde route kısıtı hatayı opak 404'e çevirirdi. Bilinmeyen argüman = hata, mesaj izinli adları listeler (A5) — agent halüsinasyonu erken yakalanır.
3. **Kenar kurallar:** absent → hiç yazılmaz, null → hata (A6); dizi query repeat-key `?tag=a&tag=b` (A7); sayı çevrimi JSON kaynak metniyle — tr-TR makinede bile `1.5` (A8); body yalnız beyanlıysa, `application/json; charset=utf-8` (A9); GET/HEAD+body üretim hatası (A10).
4. **Düz JSON + üretim-anı çakışma hatası.** Body property'leri üst seviyeye düzleşir. Çakışma (`PUT /orders/{id}` + body `id` dahil) template üretiminde fırlatır (A10) — sessiz sonek/sihir yok; sihir ancak gerçek kullanım verisi biriktikçe kanıtla eklenir. Header parametresi kimlik taşıyıcısı adı alamaz — kimlik asla argüman değildir ([karar 001](001-kimlik-tasiyicilari.md) sınırı).

## Conformance köprüsü

`argument-mapping` yeni fixture türü ([fixture.schema.json](../../packages/spec/schemas/fixture.schema.json)); 7 fixture [packages/conformance/argument-mapping/](../../packages/conformance/argument-mapping/) altında. C# testleri fixture'ları MSBuild `<None Include>` link'iyle tüketiyor (A11) — [paket-yerlesimi.md](../paket-yerlesimi.md)'deki tasarımın ilk gerçek kullanımı; NestJS SDK aynı dosyaları okuyacak.

## Test kanıtı

- Birim + pipeline karışık matris: [ArgumentMappingTests.cs](../../sdks/dotnet/tests/SkMcp.Tests/ArgumentMappingTests.cs) — A1-A11, tümü yeşil (süit toplamı 25/25).
- Uçtan uca MCP (DemoApi): `add_order_note` alice → 200 (not kalıcı, `notify` query bind), injection'lı metin body'de zararsız veri, `get_order` template üzerinden 200, bob → 403.

## NestJS doğrulaması (2026-08-28)

Composer'ın saf mantığı [packages/core](../../packages/core)'a taşındı (TS referans implementasyonu); NestJS SDK oradan tüketir. Fixture korpusu 9'a çıktı ve iki SDK'da da geçiyor (core fixture koşucusu + dotnet A11). İkinci implementasyon iki kuralı revize etti ([karar 004](004-nestjs-dogrulamasi.md)): sayı biçimlendirme kaynak-metinden **kanonik en-kısa** forma (`1.50` → `"1.5"`, C# hizalandı), integer sınırı 64-bit'ten **güvenli tam sayı aralığına**; RFC 3986 katılığı da fixture'a bağlandı. Pipeline aynası: [argument-pipeline.spec.ts](../../sdks/nestjs/test/argument-pipeline.spec.ts).
