# OAuth keşif ve istemci kaydı: `oauth4webapi`'ye geçiş

**Durum:** Uygulandı (F4)
**Tarih:** 15 Eylül 2026
**Kapsam:** `products/chat/api/src/connections`, `products/chat/contracts/src/integration`

---

## Ne oldu

Bir MCP sunucusunun yetkilendirme sunucusunu bulan keşif katmanı elle yazıldı:

- `contracts/src/integration/discovery.ts` — well-known adres üretimi, issuer doğrulama, S256 zorunluluğu
- `contracts/src/integration/authorization-metadata.ts` — RFC 8414 / RFC 9728 şemaları
- `api/src/connections/authorization-discovery.service.ts` — çekme, timeout, boyut sınırı

Yazıldıktan sonra `oauth4webapi`'nin aynı işi yaptığı görüldü. Paket **zaten bağımlılık** ve mevcut Google/GitHub giriş akışında kullanılıyor (`api/src/auth/oauth.service.ts`).

| İhtiyaç                                     | `oauth4webapi` karşılığı                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| RFC 9728 korunan kaynak metadata'sı         | `resourceDiscoveryRequest` / `processResourceDiscoveryResponse`                 |
| RFC 8414 yetkilendirme sunucusu metadata'sı | `discoveryRequest` / `processDiscoveryResponse`                                 |
| RFC 7591 dinamik istemci kaydı              | `dynamicClientRegistrationRequest` / `processDynamicClientRegistrationResponse` |
| Kendi taşıyıcımızı enjekte etme             | `customFetch` sembolü                                                           |
| Loopback üzerinden düz http                 | `allowInsecureRequests` sembolü                                                 |

`processDiscoveryResponse` issuer eşleşmesini zaten spec'e göre zorluyor — elle yazdığımız kontrolün aynısı.

## Karar

Keşif ve DCR `oauth4webapi`'ye taşınacak. Gerekçe: RFC 8414 / 9728 / 7591 elle takip edilecek şeyler değil, ve kütüphane zaten kurulu.

**Ne taşınmayacak:** SSRF koruması. `guarded-http.ts` ve `common/network-address.ts` kalıyor. `oauth4webapi` düz `fetch` kullanıyor; korumayı `customFetch` üzerinden altına geçireceğiz. Kütüphane bu işi yapmıyor ve yapması da beklenmez — hangi adreslerin erişilebilir olduğu dağıtımın kararı.

## Zamanlama

Geçiş, şema diliminden **sonraki** dilimde yapıldı/yapılacak. Sebep: kolonlar hangi kütüphanenin ürettiğinden bağımsız (RFC alanları aynı), o yüzden şema geçişi beklemeden yazılabildi. DCR'ın elle yazılıp sonra atılmaması için geçiş DCR ile aynı dilimde.

## Uygulamada ne çıktı

Kütüphane beklenenden azını devraldı. Üçü kayda değer:

**`discoveryRequest` çağrı başına tek url üretiyor.** `algorithm: "oidc"` well-known'ı sona ekliyor, `"oauth2"` başa. MCP'nin beklediği üçüncü biçim — issuer yolu ekli OIDC dokümanı — kütüphanede yok. `authorizationServerMetadataUrls` bu yüzden `@chat/contracts`'ta kaldı; adresleri biz üretip cevabı `processDiscoveryResponse`'a veriyoruz.

**`processDiscoveryResponse` sadece `issuer`'ın string olduğunu doğruluyor.** `token_endpoint` tipte `string?` ama runtime'da sayı gelebilir, ve o kolon `TEXT NOT NULL`. S256 desteğine de hiç bakmıyor. `authorization-metadata.ts` bu yüzden silinmedi: sakladığımız alanlara daraltıldı ve artık ham JSON'a değil kütüphanenin çıktısına uygulanıyor. Kimlik eşleşmesini kütüphane zorluyor, alan tiplerini zod.

**`content-type` yalnız hata yolunda zorunlu.** `getResponseJsonBody` başlığı sadece gövde ayrıştırılamazsa kontrol ediyor, yani `text/html` ile gelen geçerli JSON kabul ediliyor. Ama `parseOAuthResponseErrorBody` `application/json` şart koşuyor: DCR 400'ü yanlış başlıkla gelirse sunucunun `error` kodu okunmuyor ve istek "ulaşılamadı" gibi görünüyor. Bu yüzden `GuardedResponse` başlıkları taşımak zorunda.

## Silinenler

`verifyProtectedResource` ve `defaultResourceMetadataUrl` `@chat/contracts`'tan kaldırıldı — ilkini `processResourceDiscoveryResponse`, ikincisini `resourceDiscoveryRequest` yapıyor. `isSecureEndpoint`, `EndpointPolicy`, `authorizationServerMetadataUrls`, `resourceMetadataUrlFrom` ve `verifyAuthorizationServer` kaldı.
