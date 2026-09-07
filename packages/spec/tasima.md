# Taşıma ve OAuth 2.1

> Statü: **normatif** — iki bağımsız implementasyonla doğrulandı (ASP.NET T1-T15 + Nest N1-N6 matrisleri, ve `apps/example-agent-client` her iki demoya karşı).

Streamable HTTP taşımasının sk-mcp'ye özgü eklediklerini tanımlar: katalog değiştiğinde `tools/list_changed` bildirimi ve RFC 9728 Protected Resource Metadata (PRM) ile 401 dekorasyonu. Oturum yönetiminin, Origin/CORS/TLS'in ve yetkilendirmenin kendisinin (auth zorunlu mu) tasarımı **host'a** aittir — ASP.NET ve Express zaten birinci sınıf idiom sunar; sk-mcp bunları sarmaz, yalnız idiomu olmayan iki şeyi ekler. Gerekçe ve reddedilen alternatifler: [karar 008](../../docs/kararlar/008-tasima-ve-oauth.md).

## Kapsam

sk-mcp'nin taşıma katmanına eklediği tam yüzey:

1. `tools/list_changed` fan-out'u, katalog reload'una bağlı.
2. `GET /.well-known/oauth-protected-resource{mcpPath}` — RFC 9728 PRM dokümanı, `ResourceServer.Metadata` kuruluysa.
3. 401 yanıtlarına `WWW-Authenticate` header'ında `resource_metadata` dekorasyonu (host'un kendi 401 gövdesine ve mevcut challenge parametrelerine dokunmadan).
4. Audience kuralı (RFC 8707) — SDK doğrulamayı yapmaz, host'un `TokenValidationParameters`/verifier'ına ne yazması gerektiğini söyler.

sk-mcp **asla** `AddAuthentication`/`AddMcp`/eşdeğer bir auth pipeline'ı kurmaz; yaptırım her zaman host'un elindeki mekanizmadır (JwtBearer + `.RequireAuthorization()`, custom middleware, ya da hiçbiri).

## Oturum modu

Oturum modu SDK'nın taşıma katmanının kendi default'unda kalır; sk-mcp ayrı bir düğme eklemez.

- **.NET:** `HttpServerTransportOptions.SessionMode` default `Stateless` (2026-07-28 protokolü, `Mcp-Session-Id` yok). Host isterse `services.Configure<HttpServerTransportOptions>(o => o.SessionMode = StatefulForInitializeClients)` ile değiştirir — ASP.NET'in kendi idiomu, sk-mcp'nin sarmadığı bir yüzey.
- **Nest:** karşılığı olmayan bir yüzey olduğu için (Express'te `HttpServerTransportOptions` eşdeğeri yok) sk-mcp burada meşru bir düğme sunar: `options.transport.sessionMode: "stateless" | "stateful"`. `stateless` → `sessionIdGenerator: undefined`, `enableJsonResponse: true`, istek başına yeni `McpServer`; `stateful` → `randomUUID`, `enableJsonResponse: false`, `keepAliveMs: 30_000`, oturum `SkMcpSessionStore`'da tutulur (`idleTimeoutMs: 2h`, `maxIdleSessions: 10_000` — .NET default'larının aynası), GET/DELETE `mcp-session-id` ile depodaki oturuma yönlenir; `stateless` modda GET/DELETE `405` döner.

Stateless modda server→client bildirim mekanizması yoktur; `listChanged` bu modda **hiçbir hata üretmeden** no-op'tur (dinleyen oturum yok).

## `listChanged` semantiği

sk-mcp'nin üç meta-tool'u (`search_tools`, `load_tool`, `invoke_tool`) katalog değiştiğinde **değişmez** — arkalarındaki backend endpoint kataloğu değişir. Bu yüzden değişikliği taşıyan, meta-tool listesinin kendisi değil, her meta-tool'un `_meta` alanıdır:

- `tools.listChanged` kapasitesi her zaman `true` ilan edilir.
- Her meta-tool'un tanımına `_meta["sk-mcp/catalogGeneration"]` damgalanır — katalog snapshot'ının jenerasyon sayacı ([onbellek.md](onbellek.md) "Geçersiz kılma" — `ISkMcpCatalogChangeSource.ReloadAsync` → `Generation++`).
- Bildirim **yalnız** katalog reload'unda tetiklenir; yetki geçersiz kılma operasyonları (`InvalidateCallerAsync` vb.) katalog kataloğunu değiştirmediği için `listChanged` **tetiklemez**. `tools/list` çağrısının döndürdüğü payload, jenerasyon değiştiğinde gerçekten farklılaşır (`_meta` damgası artar) — bildirim dürüsttür, boş bir "bir şey değişti" sinyali değildir.

**.NET mekanizması:** `McpServerOptions.ToolCollection.Changed` olayı SDK'nın kendi `SendListChangedNotificationAsync`'ini tetikler (pre-SEP-2575 broadcast + 2026-07-28 `subscriptions/listen` yönlendirmesi ikisini de kapsar). sk-mcp kendi oturum kayıt defterini kurmaz — SDK'nın tek slotlu `RunSessionHandler`/`ConfigureSessionOptions`'ını gasp etmek, SDK'nın zaten yaptığı fan-out'u yeniden yazmak olurdu. Tek `NotifyChanged()` çağrısı her modda her canlı oturuma ulaşır; stateless'ta dinleyen yoksa sessizce hiçbir şey olmaz.

**Nest mekanizması:** `SkMcpStreamableHttp.notifyToolListChanged()`, `SkMcpSessionStore`'daki her oturumun `server.sendToolListChanged()`'ini çağırır (stateful modda anlamlıdır; stateless modda oturum yaşamadığı için etkisi yoktur).

**Bilinen sınır (dokümante):** .NET tarafında host kendi `ConfigureSessionOptions`'ını kullanıp per-session bir tool koleksiyon klonu oluşturuyor ve bu klon sk-mcp'nin koleksiyon referansını paylaşmıyorsa fan-out o oturuma ulaşmaz. Çok instance'lı bir dağıtımda bildirim yalnız yerel process'teki oturumlara ulaşır — instance'lar arası fan-out sk-mcp'nin kapsamı dışıdır.

## Protected Resource Metadata (PRM)

`ResourceServer.Metadata` kuruluysa (host set etmediyse PRM endpoint'i hiç yayınlanmaz, dekorasyon hiç eklenmez):

- **Yol:** `GET /.well-known/oauth-protected-resource{mcpPath}` — `mcpPath`, sk-mcp'nin bağlandığı endpoint'in yoludur (ör. `/mcp` için `/.well-known/oauth-protected-resource/mcp`), RFC 9728'in path-öneki kuralına uyar.
- **Zorunlu alanlar:** `resource` ve `authorization_servers` (en az bir eleman) — ikisi de yoksa startup validation hatası verir, PRM asla eksik yayınlanmaz.
- **Erişim:** endpoint tamamen anonimdir; kimlik doğrulama akışının ilk adımı budur, kendisi korunamaz.
- **Önbellek:** `Cache-Control: public, max-age=300`.
- **`ChallengeUri`** — `Metadata.Resource`'a `/.well-known/oauth-protected-resource` path önekini ekleyerek türetilir; gelen istekten (Host header, proxy) **türetilmez** — proxy arkasındaki kurulumlar için bu açıkça `Metadata.Resource`'un kendisidir, örtük değildir.

## 401 kuralı — birleştirme

sk-mcp'nin taşıma katmanı, korunan yol üzerindeki her `401` yanıtına `WWW-Authenticate` header'ında `resource_metadata="<ChallengeUri>"` ekler (varsa `scope="..."` de eklenir), **ama**:

- Host zaten bir `WWW-Authenticate: Bearer ...` yazdıysa (ör. ASP.NET JwtBearer'ın kendi `error="invalid_token"` challenge'ı), sk-mcp yeni bir header **eklemez** — mevcut tek `Bearer` değerine `resource_metadata` parametresini **birleştirir**. Gerekçe: hem .NET hem TS taraflarındaki `WWW-Authenticate` ayrıştırıcıları (`ParseWwwAuthenticateParameters`, `extractWWWAuthenticateParams`) tek bir `Bearer` değeri bekler; ikinci bir header istemciler için görünmez kalabilir.
- Host hiç `WWW-Authenticate` yazmadıysa (ör. custom middleware, motokurye'nin `JwtAuthenticationMiddleware`'i), sk-mcp `Bearer resource_metadata="..."` header'ını **sıfırdan** ekler.
- **Host'un 401 gövdesi hiçbir koşulda değiştirilmez** — dekorasyon yalnız header seviyesindedir; gövde sızıntı önleme kurallarını [hata-eslemesi.md](hata-eslemesi.md) tanımlar, PRM dekorasyonu ondan bağımsızdır.
- Host'un kendi SDK'sının `AddMcp`/`mcpAuthMetadataRouter`'ı zaten `resource_metadata` ekliyorsa sk-mcp bunu **görür ve dokunmaz** — PRM'yi ilk koşan servis eder, çift yazma olmaz.

## Audience (RFC 8707)

sk-mcp audience doğrulamasını **yapmaz** — host'un zaten sahip olduğu `TokenValidationParameters`/verifier mekanizmasına ne değer koyması gerektiğini söyler: `ValidAudience` (ya da eşdeğeri), `ResourceServer.Metadata.Resource` ile **aynı** olmalıdır. Token'ı basan authorization server'ın o `resource` değerini `aud` claim'ine yazması RFC 8707'nin gerektirdiğidir; host'un token doğrulayıcısı (custom validator dahil) o audience'ı kabul etmelidir ya da `ValidAudiences` listesine sk-mcp'nin MCP URL'ini eklemelidir.

## Scope delegasyonu

Scope tamamen host'a **delege** edilir: `ScopesSupported` PRM dokümanında olduğu gibi geçirilir (passthrough), sk-mcp scope içeriğine bakmaz, doğrulamaz, zorunlu kılmaz. Hangi scope'un hangi operasyon için gerekli olduğu backend'in kendi yetki katmanının (policy, guard) kararıdır — [gorunurluk.md](gorunurluk.md)'nin T1 deklaratif katmanı zaten bu kararları okur.

## Host sorumlulukları

| Sorumluluk                  | .NET                                                                                | Nest                                                                              | sk-mcp'nin rolü                                                    |
| --------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Auth zorunluluğu (yaptırım) | `.RequireAuthorization()` (`MapSkMcp`'in döndürdüğü builder üzerinde)               | Guard / middleware, host'un seçimi                                                | Hiç çağırmaz; düğme sunmaz — host'un zaten idiomatik yolu vardır   |
| Origin/CORS/DNS-rebinding   | Host'un kendi CORS middleware'i                                                     | `hostHeaderValidation([...])` (deprecated `allowedHosts` değil)                   | Middleware eklemez; bearer zorunluysa rebinding zaten token alamaz |
| TLS                         | Host'un hosting/reverse-proxy kurulumu                                              | Aynı                                                                              | Kapsam dışı                                                        |
| Oturum/gövde limitleri      | `EnableLegacySse=false`, idle 2h, `MaxIdleSessionCount` 10k (SDK/host default'ları) | `SkMcpSessionStore` default'ları (`idleTimeoutMs: 2h`, `maxIdleSessions: 10_000`) | Dokümante eder, sarmaz                                             |
| Oturum modu                 | `HttpServerTransportOptions.SessionMode` (default `Stateless`)                      | `options.transport.sessionMode`                                                   | `listChanged` fan-out'unu bu moda bağlar, modu seçmez              |
| Audience doğrulama          | `JwtBearer.ValidAudience = Metadata.Resource`                                       | `verifier`'ın döndürdüğü `authInfo.resource` + `withAudienceCheck`                | Kural + test verir; doğrulamayı host'un doğrulayıcısı yapar        |

## SDK eşleniği

| Konu                                                                                | .NET testi | Nest testi                                                        |
| ----------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| PRM anonim, RFC 9728 şekli                                                          | T1         | `transport.spec.ts` (N1–N6)                                       |
| Bearer yok → 401 + `resource_metadata`                                              | T2         | `transport.spec.ts` (N1–N6)                                       |
| Geçersiz token → 401, mevcut challenge'a birleştirilmiş                             | T3         | `transport.spec.ts` (N1–N6)                                       |
| Yanlış audience reddedilir                                                          | T4         | `transport.spec.ts` (N1–N6)                                       |
| Basılan token'ın `aud`'u MCP kaynak URL'sine eşittir                                | T6         | `transport.spec.ts` (N1–N6)                                       |
| Tam OAuth akışı (DCR → PKCE → token → `search_tools`)                               | T5         | `apps/example-agent-client` ile uçtan uca (her iki demo'ya karşı) |
| Custom-middleware host'ta (motokurye simülasyonu) gövde korunur, challenge eklenir  | T7         | — (motokurye .NET'e özel)                                         |
| `ResourceServer` kurulu değilse PRM/dekorasyon hiç yok                              | T8         | `transport.spec.ts` (N1–N6)                                       |
| Stateful oturum, `ReloadAsync` sonrası `tools/list_changed` alır                    | T9         | `transport.spec.ts` (N1–N6)                                       |
| Stateless'ta bildirim yok, hata yok                                                 | T10        | `transport.spec.ts` (N1–N6)                                       |
| `initialize` `tools.listChanged` ilan eder                                          | T11        | `transport.spec.ts` (N1–N6)                                       |
| `tools/list` `_meta` jenerasyonu taşır, değişimden sonra artar                      | T12        | `transport.spec.ts` (N1–N6)                                       |
| Host'un kendi `AddMcp`/`mcpAuthMetadataRouter`'ı varsa çift `resource_metadata` yok | T13        | `transport.spec.ts` (N1–N6)                                       |
| `.RequireAuthorization()` anonim `initialize`'ı engeller                            | T14        | `transport.spec.ts` (N1–N6)                                       |
| `ResourceServer.Metadata.Resource` yoksa validation hatası                          | T15        | `transport.spec.ts` (N1–N6)                                       |

Nest tarafında granüler test-konsept eşlemesi `transport.spec.ts` dosyasının kendisindedir (uygulama detayı); tam OAuth round-trip her iki SDK'da da SDK'nın kendi test paketinde değil, [apps/example-agent-client](../../apps/example-agent-client) ile çalışan demo'ya karşı doğrulanır — bu, dotnet tarafında da T5'in xunit içindeki TestServer koşusuna **ek olarak** geçerlidir, tek doğrulama yolu değildir.

## Demo authorization server

Repo içi, Docker'sız, dış servissiz bir authorization server (`sdks/dotnet/samples/DemoAuthServer/`, Nest tarafında SDK'nın kendi `mcpAuthRouter`'ı + in-memory provider) üç bitiş kriterinin de (DemoApi, xunit `TestServer`, Nest demo) aynı process içinde OAuth 2.1 akışını (DCR, PKCE zorunlu S256, authorization code, refresh) uçtan uca koşturabilmesi için vardır. Harici bir authorization server (Keycloak, Duende, Auth0) yalnız "prod'da böyle bağlanırsınız" dokümanı olarak geçer, repo'ya girmez. Gerekçe: [karar 008](../../docs/kararlar/008-tasima-ve-oauth.md).
