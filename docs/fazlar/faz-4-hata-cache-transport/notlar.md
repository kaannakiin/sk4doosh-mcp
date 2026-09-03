# Faz 4 — Notlar

Tarih: 2026-09-03. Kapsam: dört kalem de kodlandı ve testlendi — hata eşlemesi, çağıran-kapsamlı önbellek + geçersiz kılma, `listChanged`, Streamable HTTP + OAuth 2.1 resource server. Kalan: motokurye entegrasyonu (host tarafı) ve dalga-3 sertleştirme.

## Açık soruların cevapları

**"Yetki değişti" sinyali generik olarak ne?** Manuel geçersiz kılma API'si, hem kimlik-kapsamlı hem global: `ISkMcpCacheInvalidator { InvalidateCallerAsync(CallerScope), InvalidateTagAsync(string), InvalidateAllAsync() }`. Polling yok, event altyapısı dayatılmıyor. İmza sorusunun cevabı **etiket**: backend kullanıcı kimliğini bilir, SDK yalnız taşıyıcı özetini bilir; köprü `ICallerScopeResolver`'ın `CallerScope.Tags`'e yazdığı `user:42` / `tenant:7` gibi etiketlerdir. Bu, Redis'in "tag set" pratiğinin bellekteki karşılığı ve dağıtık bir uygulamaya aynen taşınabilir.

**Eviction politikası: TTL mi, boyut mu?** İkisi birden. `Cache.Lifetime` (30 sn default, sıfır = kapalı) çağıranın ilk yazımından **mutlak** TTL'dir ve aynı zamanda yetki değişiminin maksimum yansıma gecikmesidir; `Cache.MaxCallers` (128) yalnız **yeni çağıran kabul edilirken** en-az-kullanılanı düşürür. Süresi dolan girişler dokunuşta/kabulde tembel silinir; `ClearAsync` iki sözlüğü değiştirerek O(1)'dir. Faz 3'ün probe-özel ayarları (`ProbeCacheLifetime`, `ProbeCacheMaxCallers`) kaldırıldı: önbellek artık T1 `CallerFacts`'i de tuttuğu için `Probe` öneki yanlış olurdu.

**OAuth scope'ları: kendi mi, delege mi?** Tamamen delege. `ScopesSupported` PRM dokümanında yalnız taşınır; SDK hiçbir scope tanımlamaz, okumaz, zorunlu kılmaz. Yaptırım her zaman host'un kendi katmanındadır (`RequireAuthorization`, JwtBearer, ya da custom middleware). Bu, "ekstra yetki katmanı vermeyiz" ilkesinin transport hali.

**ProblemDetails kullanmayan backend'ler için fallback?** Sıralı tanıyıcı zinciri: `errors` sözlüğü → ProblemDetails → Nest zarfı → mesaj zarfı (`message`/`detail`/`error_description`/`error`/`title`/`reason` ya da düz JSON string literal) → düz metin → yalnız status. motokurye'nin üç ayrı biçimi (`{error,message}`, `{Succeded,Message}`, `BadRequest("callId zorunludur.")`) hiçbir host koduna gerek kalmadan dördüncü ve beşinci basamağa düşüyor.

## Alınan kararlar

- **Genişletme çerçevesi** ([karar 006](../../kararlar/006-genisletme-noktalari.md)): altı değiştirilebilir nokta (`IVisibilityEvaluator`, `IProbeEvaluator`, `ICallerScopeResolver`, `ISkMcpCache`, `IInvokeResultMapper`, `IProtectedResourceMetadataProvider`), iki giriş noktası (`ISkMcpCacheInvalidator`, `ISkMcpCatalogChangeSource`), gerisi sealed. Tüm kayıtlar `TryAdd*`; `AddSkMcp` bir işaretle idempotent — host implementasyonunu `AddSkMcp`'den **önce de sonra da** kaydedebilir (K13/K14 sabitliyor).
- **`isError` kullanılır, JSON-RPC hatası kullanılmaz.** Backend'in reddettiği istek her zaman `isError: true` taşıyan normal bir sonuçtur; JSON-RPC seviyesi yalnız protokol ihlaline ayrılmıştır. Agent tek dalda karar verir.
- **401 gövdesi asla iletilmez, 403 detail'i temizse iletilir.** Asimetri kasıtlı: 401'de agent'ın yapabileceği tek şey yeniden kimliktir ve standart mesaj bunu zaten söyler; 403'te "başkasının siparişi" / "mesai dışı" gibi kaynak-seviyesi gerekçeler eyleme dönüştürülebilir. motokurye'nin `"Portal resolution failed: <db hatası>"` 401'i bu kuralın somut gerekçesi.
- **Sızıntı filtresi iki katmanlı ve mekaniktir** ([karar 007](../../kararlar/007-hata-eslemesi.md)): önce yapısal kurallar (401/5xx/HTML gövdeleri hiç okunmaz, header allowlist'i), sonra iletilecek 4xx metinlerine altı imza ailesinden oluşan deny-list. Yanlış pozitifin bedeli mesajın standarta düşmesidir — güvenli taraf. `\bError\b` bilinçli olarak listede değil ("Error: quantity must be positive" geçmeli, fixture'lı). Dürüst sınır: bu bir güvenlik sınırı değil, savunma derinliğidir; asıl çözüm backend'in sızdırmamasıdır.
- **Session mode düğmesi eklenmedi** ([karar 008](../../kararlar/008-tasima-ve-oauth.md)): ASP.NET'te `services.Configure<HttpServerTransportOptions>(...)` zaten idiomdur, aynası saf tekrar olurdu. Nest'te karşılığı olmadığı için orada `transport.sessionMode` meşru bir düğme.
- **`listChanged` dürüst kılındı.** Üç meta-tool'un listesi hiç değişmez; değişen arkadaki katalogdur. Bu yüzden `ToolListChangePublisher` her tool'un `_meta["sk-mcp/catalogGeneration"]` alanına jenerasyonu damgalar ve bildirimi yalnız `SkMcpCatalogProvider.ReloadAsync` sonrası gönderir — `tools/list` payload'u gerçekten farklılaşır (T12). Yetki geçersiz kılma bildirim tetiklemez: tool listesi değişmiyor.
- **SDK `AddAuthentication` çağırmaz.** `UseSkMcpCapture` içine giren `ResourceServerMiddleware` PRM'yi servis eder ve 401'i dekore eder; yaptırım host'un elindeki neyse odur. Bu, ASP.NET authentication'ı hiç kurmayan motokurye'nin de kapsandığı tek şekil (T7 bunu simüle ediyor).

## Sürprizler / teknik notlar

- **`Stateless` artık default.** ModelContextProtocol 2.2.0 protokol revizyonu 2026-07-28'i uyguluyor: SEP-2567 `Mcp-Session-Id`'yi, SEP-2575 `initialize` el sıkışmasını kaldırdı. Stateless modda **istenmeyen server→client mesajı gönderilemez**, dolayısıyla `listChanged` teslim edilemez ve sunucu kapasiteyi dürüstçe ilan etmez (T10/T11 bunu sabitliyor). Bildirim isteyen host `SessionMode = Stateful` yazar. 2026-07-28 client'ları ayrıca `subscriptions/listen` ile abone olmalı; testler `LegacyProtocolVersion` pinleyerek klasik yayını sınıyor.
- **`ProtectedResourceMetadata.BearerMethodsSupported` default'u boş değil.** `{ "header" }` küme-başlatıcısı mevcut listeye `Add` yaptığı için PRM dokümanında `["header","header"]` çıktı; `= ["header"]` koleksiyon ifadesi listeyi değiştirir. Yalnız canlı smoke testinde yakalandı.
- **`WwwAuthenticateScope` okunamıyor.** 2.2.0'da getter'ı internal; SDK'nın kendi dokümantasyonu onu "client'ın bir challenge'dan **okuduğu** scope" olarak tanımlıyor, resource-server girdisi olarak değil. Bu yüzden 401 dekorasyonu yalnız `resource_metadata` ekliyor.
- **Demo AS ile .NET client'ın DCR uyuşmazlığı.** `ClientOAuthProvider` kayıt isteğinde `token_endpoint_auth_method: "client_secret_post"` gönderiyor — AS metadata'sı `["none"]` ilan etse ve `application_type` doğru şekilde `native` çıkarılsa bile. Katı bir public-client kontrolü T5'i deterministik olarak kırdı; DemoAuthServer `client_secret_post`/`client_secret_basic`'i de kabul edip yanıtta `none` dönecek şekilde gevşetildi (demo AS, üretim değil).
- **`scope: null` zod'u kırıyor.** Demo AS token yanıtında scope alanını açık `null` olarak yazınca TS client'ın şeması reddediyordu (`string | undefined` bekliyor); alan artık boşken hiç yazılmıyor. RFC 6749 zaten "isteğe bağlı" diyor, `null` değil.
- **`HttpContextAccessor` AsyncLocal tuzağı** (Faz 3'ten devam): çok kimlikli testlerde sabit `IHttpContextAccessor` uygulaması kullanılmalı; `VisibilityHost.cs`'e taşındı ve `CacheTests` de onu kullanıyor.
- **`SingleFlight` yarışı.** İlk yazımda `GetOrAdd` fabrikası birden çok kez koşabildiği için lider tespiti yanlıştı; oluşturulan `TaskCompletionSource.Task` ile dönen görev referans karşılaştırılarak düzeltildi (gözden geçirme yakaladı).
- **Kayıt kimliği** (`CallerScope.Key`) kanonik özet girdisiyle spec'e sabitlendi: taşıyıcı adları küçük harfe indirgenip ordinal sıralanır, `ad=değer\n` satırları birleştirilir, SHA-256 hex. İki SDK aynı girdiden aynı anahtarı üretmek zorunda; `digestInput` her iki tarafta public.

## Ölçüm ve doğrulama

| Kapsam                      | Sonuç                                                        |
| --------------------------- | ------------------------------------------------------------ |
| dotnet test paketi          | 117/117 (E1–E15 hata eşleme, K1–K19 önbellek, T1–T15 taşıma) |
| conformance fixture'ları    | 99 (36'sı `error-mapping`)                                   |
| `@sk-mcp/core` vitest       | 231                                                          |
| `@sk-mcp/sdk-nestjs` vitest | 41                                                           |
| `pnpm turbo run build`      | 8/8, dotnet tarafı 0 uyarı 0 hata (net8/net9/net10)          |

**Bitti kriteri 1 — dış client OAuth 2.1'i tamamlıyor.** `SKMCP_AUTH=oauth` ile `example-agent-client`: 401 → PRM keşfi → AS metadata → dinamik kayıt → PKCE S256 → token → `search_tools`/`load_tool`/`invoke_tool`, exit 0. Aynı akış T5'te `TestServer` içinde otomatik.

**Bitti kriteri 2 — yetki değişikliği restart olmadan yansıyor.** K12: yetki verilir → tool görünür; geri alınır → önbellek ömrü içinde hâlâ görünür ama `invoke_tool` 403 (görünürlük ≠ yaptırım); `InvalidateTagAsync("user:alice")` → tool kaybolur, bob etkilenmez, süreç yeniden başlatılmaz.

**Bitti kriteri 3 — agent yalnız hata payload'ını okuyarak düzeltip yeniden deniyor.** `--scenario validation-retry`: `create_order` bilerek `{item:"", quantity:0}` ile çağrılır → `validation_failed` + `item`/`quantity` alan hataları → istemci **yalnız payload'daki alan adlarından** düzeltmeyi üretir → 200. Exit 0, hem `oauth` hem `token` modunda.

## Ertelenenler

- **motokurye entegrasyonu**: `Identity.Forward("x-enrollment")` + `.Forward("X-PortalCode")`, `MotokuryeCallerScopeResolver` (etiket `user:{sub}`, `portal:{...}`), `PermissionService.BumpUser(s)PermissionVersion` → `InvalidateTagAsync` köprüsü, `smoke` + `error-envelope` koşusu. Host tarafı iş; OAuth akışı orada bir authorization server kurulana kadar koşulamaz (PRM ve 401 dekorasyonu koşulabilir).
- **`JsonSchemaMapper` gövde alanları için `required` üretmiyor**: `load_tool` şeması gövde alanlarını isteğe bağlı gösteriyor, agent eksik alanla çağırıp 400 alıyor. Hata eşlemesi bunu kurtarıyor (alan adlarıyla `validation_failed`) ama şema yanlış. Faz 3 kapsamı, ayrı iş olarak açıldı.
- **Dalga-3 fixture'ları** ve `Retry-After` HTTP-date biçimi.
- **Dağıtık `ISkMcpCache` adaptörü**: talep kanıtlanınca (çok instance'lı motokurye kurulumu) yazılır; SDK değişikliği gerektirmiyor.
