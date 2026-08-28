# Karar 004 — NestJS Doğrulaması ve Sentetik Bağlam

Tarih: 2026-08-28. Durum: **kabul edildi, kodla kanıtlandı** (core 30/30, sdk-nestjs 21/21, dotnet A-matrisi 11/11, demo-api MCP el matrisi).

## Ne yapıldı

Request katmanının 1-3. adımları NestJS/Express'te ikinci kez implemente edildi: composer'ın saf mantığı [packages/core](../../packages/core)'a taşındı (TS referans implementasyonunun ilk gerçek runtime kodu), Nest'e bağımlı dispatcher/modül [sdks/nestjs](../../sdks/nestjs)'e. Aynı 9 conformance fixture'ı iki SDK'da da geçiyor — spec'in dil-bağımsızlık iddiasının ilk gerçek kanıtı. Faz 6'nın kalanı (metadata hasadı, decorator katmanı, arama) bu kararın kapsamı dışında.

## Ana karar: sentetik bağlamı SDK kendisi kurar

İlk deneme `light-my-request` idi (Fastify `inject()`'inin altındaki kütüphane). Express modu app'i kalıcı zehirliyor: `index.js:77-78`, dispatch fonksiyonunda `.request`/`.response` görünce app'in response prototip zincirine kendi `Response.prototype`'ını sokuyor. İlk inject'ten sonra süreçteki **tüm gerçek HTTP yanıtları** lmr'nin `writeHead/write/end` override'larından geçiyor; lmr iç state'i olmayan gerçek yanıt `TypeError` ile ölüyor (ilk kurban MCP transport'un hono yazıcısı oldu; demo süreci `ERR_INTERNAL_ASSERTION` ile çöktü). Saf test kullanımında görünmez — gerçek trafik yok; gömülü üretim kullanımında ölümcül.

Çözüm C# ile aynı felsefe: sentetik req/res'i SDK kurar — [synthetic-context.ts](../../sdks/nestjs/src/synthetic-context.ts), `DefaultHttpContext + Response.Body = MemoryStream`'in Node karşılığı. `IncomingMessage` + `ServerResponse`, gövde yakalama own-property `write`/`end` ile; harici bağımlılık yok. Kazanım: scheme `socket.encrypted` ile doğrudan temsil edilir — `x-forwarded-proto` + `trust proxy` zorunluluğu ortadan kalktı, Express `req.protocol` doğal çalışıyor (M1).

## Platform asimetrileri

- **Capture:** ASP.NET'te elle yakalama (`UseSkMcpCapture`); Nest'te framework pipeline'ı DI'dan verir (`HttpAdapterHost.httpAdapter.getInstance()`), capture adımı yok. Spec garantisi platformdan bağımsız kalır: _sentetik istek gerçek pipeline'ın tamamından geçer_ — mekanizma SDK'nın iç işi.
- **`TraceIdentifier`** ASP.NET'e özgü; Express'te karşılığı yok. Genel kural: `traceparent`/`tracestate` her zaman taşınır; platform istek kimliği varsa o da taşınır ([karar 003](003-istek-ustverisi.md) revizyonu).

## Spec revizyonları (ikinci implementasyonun düzelttikleri)

1. **Sayı biçimlendirme:** "JSON kaynak metni" → **kanonik en-kısa serileştirme** (`1.50` → `"1.5"`). TS'e argümanlar parse edilmiş değer olarak gelir, kaynak metin yoktur; C# `GetRawText`'ten `GetDouble` + invariant'a hizalandı. Fixture: `number-canonical-form`.
2. **Integer sınırı:** "64-bit" → **güvenli tam sayı aralığı** (|n| ≤ 2^53−1), kesirsiz (`1.0` → `"1"`); iki dilin kesişimi.
3. **Percent-encode RFC 3986 katılığı** fixture'a bağlandı (`!'()*` ve boşluk kodlanır; `encodeURIComponent` tek başına yetmez). Fixture: `percent-encoding-rfc3986`.

Hipotez v0 mekanizması tam beklendiği gibi çalıştı: n=1'de doğru görünen üç kural n=2'de revize edildi.

## Test kanıtı

- core: template/composer birimleri + fixture koşucusu — 30/30 ([packages/core/test](../../packages/core/test)).
- sdk-nestjs: S1-S9, M1-M7, A-pipeline aynaları — 21/21 ([sdks/nestjs/test](../../sdks/nestjs/test)).
- dotnet: A-matrisi + A11 koşucusu yeni fixture'larla — 11/11.
- Uçtan uca MCP ([demo-api](../../sdks/nestjs/samples/demo-api)): alice `get_order` 200 / `add_order_note` 201 (CRLF+SQL injection'lı metin body'de zararsız veri, `notify` query bind), bob 403, anonim 401; gerçek trafik dispatch sonrası sağlıklı (lmr zehirlenmesi yok).

## Bilinen kapsam sınırları (iki SDK'da simetrik)

Dispatch sözleşmesi v0 bilinçli dar: istek body'si yalnız JSON (multipart/form-data composer kapsamı dışı — mekanizma değil kompozisyon sınırı; sentetik stream içerik-agnostiktir, gün geldiğinde yalnız composer değişir), yanıt `{status, body:string}` (binary yanıt ve yanıt header'ları taşınmaz — response tarafı Faz 3/4), yanıt tamamı bellekte ve sonsuz stream'de dispatch asılı kalır (timeout/boyut sınırı adım 5). Sınırlar C# `DispatchResult` ile birebir aynı; genişletme iki SDK'da birden yapılır.

Kapsam dışı: adım 4 (pipeline girişi politikaları; `/mcp` self-dispatch recursion kilidi iki SDK'da da açık), adım 5 (yaşam döngüsü).
