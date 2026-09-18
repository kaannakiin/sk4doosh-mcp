# Invoke Korumaları Kararı — yanıt bütçesi, deadline, iptal merdiveni

**Durum:** Sevk edildi. Spec [packages/spec/invoke-semantics.md](../../packages/spec/invoke-semantics.md), iki SDK'da uygulandı, 13 yeni fixture.
**Tarih:** 18 Eylül 2026
**Kapsam:** `packages/spec`, `packages/core`, `sdks/nestjs`, `sdks/dotnet` — HTTP katalog ürün hattı
**Kaynak tartışma:** [fastmcp-karsilastirma.md](fastmcp-karsilastirma.md) §4.2

---

## 1. Karar

`invoke_tool` bugüne kadar sınırsızdı: yanıt boyutu için kapı, süre için deadline, iptal için kanal yoktu. Üçü de eklendi.

- **Yanıt bütçesi** üç meta-tool'un hepsinde, varsayılan 256 KiB. Aşan yanıt **reddedilir, asla kesilmez**.
- **Invoke deadline'ı** yalnız `invoke_tool`'da, varsayılan 30 000 ms.
- **İptal merdiveni** L0/L1/L2 olarak normatif, ve L2 asla vaat edilmez.

Karşı taraf olan FastMCP'nin bu alanda opt-in bir `ResponseSizeLimitMiddleware`'i (500 KB'de keser) var; asıl karşılaştırma noktası o değil, `packages/file-core`'un çoktan verdiği karardır (512 KiB, `resource_limit`, reddeder). Aynı üründe iki farklı cevap olmasın diye kapandı.

## 2. Neden kesme değil ret

Preview daha ucuz bir başarısızlık değil:

1. Kapının koruduğu bütçenin **tamamını** harcar ve karşılığında kullanılamaz bir parça verir.
2. Kesik diziden cevap üretilemeyeceği için retry'ı zaten zorunlu kılar — yani maliyeti "bütçe + retry".
3. Ajanın `truncated` bayrağını atlayıp önündeki parçadan emin cevap verme riskini ekler.

Ret ~300 bayta mal olur ve ajanı doğru bir resimle bırakır.

Ama saf ret de yeterli değildi. Ayrım şurada: **SDK'nın belleğindeki bayt bedava, ajanın context'indeki bayt değil.** Gövde dispatcher'da zaten string olarak duruyor, dolayısıyla _saymak_ CPU'ya mal olur. Red bu yüzden `payload: { bytes, limit, shape }` taşır — `shape` gövde hakkında bir olgu, gövdeden alınmış bir string değil, yani leak kuralları filtreleyerek değil yapısal olarak sağlanır. Ve `fields` tool'un kendi daraltıcı argümanlarını adıyla söyler; `inputSchema` elimizde olduğu için yapabildiğimiz, FastMCP'nin şemadan habersiz middleware'inin yapamadığı şey budur.

## 3. Yol üstünde çıkan üç bulgu

Bunlar kodu okumadan görülmeyen, sonraki okuyucunun yoksa zor yoldan yeniden keşfedeceği şeyler.

### B1 — Nest bir route handler'ını disconnect'te unsubscribe etmiyor

`router-response-controller.js` (11.2.3 ve 12.0.1, ilgili yollarda birebir) `transformToResult`'ta Observable'ı `lastValueFrom` ile düzlüyor. Normal route yolunda `takeUntil` yok, close'da unsubscribe yok. Tek abort makinesi `getOrCreateAbortController` ve yalnız `sse()`'den ulaşılıyor.

Yani L2 bedava gelen yerler: `@Sse()` route'ları, kendi `takeUntil(fromEvent(req,'close'))` yapan interceptor'lar, `@Req()` okuyup `req.on('close')` bağlayan handler'lar. **Düz `Observable` dönen controller dahil değil.** Bu yüzden L2 spec'te vaat değil, koşul.

Ve kinde bir fark yok: `CancellationToken` da kooperatif, .NET de thread öldürmez. İki platform arasındaki fark mekanizma değil, sinyalin kütüphane imzalarından ne kadar konvansiyonel olarak geçtiği.

### B2 — MCP SDK'sının kendi catch'i filtresiz bir sızıntı kanalı

`@modelcontextprotocol/sdk@1.30.0` `server/mcp.js:135-152` handler'ı sarıyor ve yakaladığı her şeyi `createToolError(error.message)` ile **ham** yayıyor: zarf yok, leak filtresi yok, bütçe yok, `retryable` yok. Bozuk bir value provider'ın `TypeError`'ı dosya yoluyla birlikte ajana gidiyordu.

Düzeltme `meta-tools.ts`'teki rethrow satırında değil, choke point'te catch-all: her fırlatma `internal_error` zarfına dönüyor ve mesaj `forwardable()`'dan geçiyor.

### B3 — 60 saniyelik tavan

TS MCP **client**'ının `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000`'i var; sunucuda hiçbir dilde per-call timeout yok. `timeoutMs >= 60_000` stok client'ta ölü kod — client önce iptal eder. Varsayılan bu yüzden 30 000.

İlgili: çağıran iptal ettiğinde `shared/protocol.js` göndermeden önce `if (signal.aborted) return;` yapıyor. O yüzden `invoke_timeout` **yalnız deadline dolduğunda** yayılıyor; çağıran iptalinde okuyacak kimse yok.

## 4. Kapatılan defektler

Keşif sırasında çıktılar, bütçeden bağımsızlar.

| Defekt                                                      | Etki                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `synthetic-context.ts` promise'i yalnız `resolve` taşıyordu | Yanıtı hiç bitirmeyen bir handler MCP çağrısını **sonsuza kadar** asıyordu  |
| `pipeline(req, res)` await edilmiyor, catch edilmiyordu     | Senkron fırlatan bir pipeline sahipsiz bir promise bırakıyordu              |
| `extra.signal` hiç okunmuyordu                              | Ajanın iptali backend çağrısını hiç etkilemiyordu                           |
| Terk edilmiş handler'ın geç `res.end()`'i                   | Çift resolve, ikinci `finish`/`close` yayını, okunmuş `chunks`'ın mutasyonu |
| Probe reddi                                                 | Tek bir asılı endpoint `search_tools`'un tamamını düşürüyordu               |
| C#'ta `search_tools` paylaşılan formatter'ı atlıyordu       | Bütçe kapısının kuracağı tek çıkışı delen asimetri                          |

## 5. Bilinçli sınırlar

- **Bayt sayıları diller arası eşit değil.** `System.Text.Json` ASCII dışını `\uXXXX`'e kaçırır, `JSON.stringify` kaçırmaz. Limite birkaç yüzde yakın bir yük bir SDK'da reddedilip diğerinde geçebilir. Saf fonksiyon bu yüzden `bytes`'ı girdi olarak alır ve core hiçbir şey ölçmez. Eşitlemek normatif bir serileştirme ister; ayrı bir karar.
- **Mesajlardaki her sayı integer.** `tr-TR`'de `30.0` → `30,0` olurdu.
- **Gate'ten önce bellek amplifikasyonu duruyor.** İki SDK da tüm gövdeyi tamponluyor; gigabaytlık bir endpoint bütçe hiç koşmadan belleği tüketir. Mevcut durum, bu değişiklikte ikinci bir knob eklenmedi.
- **`invoke_timeout` `retryable: true`** ve bu çift yazma üretebilir. Mesajdaki "zaten uygulanmış olabilir; tekrar denemeden önce oku" cümlesi tehlikeyi bayrakla gizlemek yerine yayınlıyor. Mevcut 504 davranışıyla tutarlı.
- **`load_tool` reddi ajan için kurtarılamaz.** Şemanın kendisi bütçeyi aşıyorsa daraltacak argüman yok; host tarafı çözüm `schema-conversion-rules.md`'nin derinlik bütçesi.
- **`SdkErrorCode` ve `BackendErrorCode` ayrık kalmak zorunda.** Ortak üye `InvokeResult` union'ını iki dala birden eşleştirir ve ajv mesajı gerçek sebebi değil kök `Fixture` union'ını suçlar.

## 6. Şema kararı ve bir yan kapanış

Yeni kodlar `invoke-result.schema.json`'a üçüncü `oneOf` dalı olarak girdi: `SdkError`, kendi `SdkErrorCode` enum'u, `status` **required değil**. `BackendErrorCode` dokuz backend kodu olarak saf kaldı.

Bu arada duran bir açık kapandı: `error-mapping.md` "SDK-side kodlarda `status` yoktur" diyordu ama `MappedError` şeması `status`'ü required yapıyordu ve `error`'ı dokuz backend koduyla sınırlıyordu. Yani bugünkü `unknown_tool` zarfı kendi yayınlanmış şemasına uymuyordu. Artık uyuyor ve üç kod (`unknown_tool`, `not_invocable`, `unknown_argument`) ilk kez fixture'lı.

Fixture tarafında yeni kind açılmadı; `error-mapping`'in `input`'u iki dallı bir `oneOf` oldu. Gerekçe teknik: **C# üreticisi kök union için hiçbir şey üretmiyor**, dolayısıyla C# `InvokeOutcome` hiyerarşisindeki eksik üçüncü vaka `gen`'den de `build`'den de `check-types`'tan da sessizce geçiyor. Onu yakalayan tek guard `ErrorMappingTests.E1`'in glob'ladığı `error-mapping/` dizini. Fixture'ları düzen adına yeni bir dizine taşımak o guard'ı siler.

## 7. Doğrulama

| Süit                                       | Sonuç                      |
| ------------------------------------------ | -------------------------- |
| `@sk-mcp/core`                             | 378/378                    |
| `@sk-mcp/sdk-nestjs`                       | 358/358 (17 atlanan)       |
| `@sk-mcp/sdk-dotnet`                       | 175/175, net8.0 ve net10.0 |
| `pnpm validate`                            | 220/220                    |
| `pnpm lint` / `check-types` / `boundaries` | temiz                      |
