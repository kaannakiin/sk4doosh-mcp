# OpenAPI Dokümanı Katalog Kaynağı Olarak

**Durum:** kabul edildi — uygulama bu kaydı takip eder
**Tarih:** 24 Eylül 2026
**Kapsam:** `packages/http/spec`, `packages/http/conformance`, `packages/http/core`, yeni `packages/http/openapi`, yeni `packages/servers/openapi-mcp`, `sdks/*`
**Yerine geçtiği tartışma:** [fastmcp/fastmcp-karsilastirma.md](fastmcp/fastmcp-karsilastirma.md) §5, tartışma noktası 2
**Kardeş kayıtlar:** [cerez-parametre-karari.md](cerez-parametre-karari.md), [uzak-kimlik-karari.md](uzak-kimlik-karari.md)

---

## 1. Karar

Swagger 2.0 ve OpenAPI 3.0–3.2 dokümanı, framework metadata'sının yanında **ikinci bir descriptor kaynağı** olur. Doküman `EndpointDescriptor[]`'a indirilir; oradan sonrası — isimlendirme, seçim, küratörlük, şema kuralları, compose, hata haritalama, search, bütçe — bugünkü katalogla bayt bayt aynı yoldan geçer. Çağrı sentetik istekle değil, ağ üzerinden `fetch` ile uzak backend'e gider.

Bu, notun "üçüncü ürün şekli" dediği şey. Stratejik soru şu gerekçeyle kapandı: gömülü SDK yalnız NestJS ve ASP.NET Core'a ulaşır; dokümanı olan her backend'e ulaşmanın tek yolu doküman.

## 2. Ne kaybediliyor, ne kalıyor

**Kaybedilen:** replay pipeline'ı, T2 probe, guard/policy okuma. Doküman backend'in yetki kararını taşımaz; `security` yalnız hangi credential'ın gerektiğini söyler, kimin neye erişebileceğini değil. Sonuç: her endpoint'in görünürlüğü `unknown`, kart `authUncertain` taşır. Bu bilinçli: invariant 1 zaten enforcement'ı backend'de tutuyor, görünürlük bir liste filtresi.

Uzak probe **yapılmaz.** Gömülü probe handler'ı kesen bir interceptor'a dayanır; uzakta aynı istek handler'ı gerçekten çalıştırır.

**Kalan:** kataloğun görünürlük dışındaki her kuralı. `security: []` açıkça anonim diyorsa `anonymous: "yes"` yazılır; başka hiçbir durumda görünürlük tahmini yapılmaz.

## 3. Paket ayrımı

| Paket                                                           | Rol                                                                                                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/http/openapi` (`@sk-mcp/openapi`, private)            | doküman → IR → `EndpointDescriptor[]` + sunucu haritası + güvenlik modeli + tanılar. Ağa çıkmaz: dış `$ref` için fetcher enjekte edilir                         |
| `packages/http/core`                                            | Nest SDK'da tutsak kalmış generic katman buraya taşınır: catalog pipeline, meta-tool handler'ları, dispatcher, `Invoker` portu. Runtime bağımlılığı sıfır kalır |
| `packages/servers/openapi-mcp` (`@sk-mcp/openapi-mcp`, private) | config, credential, tek `fetch` dosyası, stdio + streamable HTTP                                                                                                |

Parser bağımlılıkları (`@apidevtools/json-schema-ref-parser`, `@scalar/openapi-upgrader`, doğrulayıcı) yalnız `@sk-mcp/openapi`'de. Core'a girseydi iki SDK'nın ve bütün conformance runner'ların bağımlılık ağacına girerdi.

Gateway şimdilik `private: true`. Yayınlanan paket private pakete bağımlı olamaz ve core private; core'u yayınlamak ya da gateway'e bundle etmek ayrı bir karar.

`@sk-mcp/mcp-core` kullanılmaz: `createMcpSourceServer` yalnız salt-okur tool kabul eder, `createMcpOutputServer` `destructiveHint: false` ister. Uzak backend'e DELETE gönderebilen `invoke_tool` için ikisi de yanlış beyan olurdu. `guard()` handler'a `ctx.http`/`authInfo` vermez; token exchange çağıranın token'ını görmek zorunda.

## 4. Ağ kuralları

Gateway ağa çıkan bir süreç; ajan onun eliyle istek attırır. Kurallar llm-mcp'nin tek-dosya desenini izler:

- `fetch`, `node:http|https|net|tls`, `undici` paket genelinde lint-yasak; tek istisna `src/net/fetch.ts`. Yasak her override'a katlanır — override seçenekleri birleştirmez, değiştirir.
- Host allowlist: seçilen sunucunun host'u + operatörün açıkça eklediği host'lar. Operasyon seviyesinde allowlist dışı bir sunucu endpoint'i düşürür (`server_host_not_allowed`).
- `redirect: "manual"`. 3xx, error-mapping'in bugünkü kuralıyla `location` taşıyan başarı olarak ajana döner; gateway yönlendirmeyi takip etmez. Takip etseydi allowlist bir `Location` header'ıyla aşılırdı.
- Deadline `AbortSignal.any([çağıran, timeout])`; yanıt stream'le okunur ve bütçe aşıldığında kesilir — önce tamamını okuyup sonra ölçmek, bütçenin koruduğu belleği harcar.
- Credential yalnız allowlist host'a gider.
- Dokümanın dış `$ref`'leri aynı allowlist'ten, zaman ve boyut sınırıyla geçer; dosya `$ref`'i kök dizinin dışına çıkamaz. Dış ref, doküman yazarına gateway'in içinden istek attırmanın yoludur (SSRF).

## 5. Sessizlik yok

İncelenen her açık kaynak adaptör en az bir yerde sessiz: FastMCP parse edilemeyen operasyonu yalnız loglar, bilinmeyen `in`'i query yapar, ilk media type'ı seçer; openapi-mcp-generator her query dizisini virgülle birleştirir; mcp-openapi-server cookie parametresini düşürür; swagger-js path ve operasyon parametrelerini yalnız ada göre birleştirir.

Kural: dokümandaki desteklenmeyen her şey **JSON pointer'lı bir tanı** üretir. Severity üç değerli — `fatal` (katalog kurulmaz), `endpointDropped` (o endpoint düşer, gerekçesi raporlanır), `warning`. Severity tablosu `satisfies Record<IngestionCode, CatalogSeverity>` ile yazılır; yeni bir kod eklenip severity'si unutulursa derleme kırılır.

Bir tanı dokümanın yazarına söylenir, ajana değil: ajan dokümanı düzeltemez.

## 6. Fixture profilleri

`fixture-format.md` "her SDK her fixture'ı geçer" diyor. Ingestion yalnız OpenAPI okuyan implementasyonun işi; .NET SDK'sı hiçbir zaman doküman okumaz. Kuralı bozmamak için **profil** kavramı gelir:

- **core profili:** bugünkü bütün kind'lar. Her SDK'yı bağlar, değişmez.
- **openapi-ingestion profili:** yalnız OpenAPI ingest eden implementasyonları bağlar.

.NET runner profili açık bir listeyle atlar, dizin taramasıyla değil — dizin taraması yeni eklenen bir core kind'ını da sessizce atlardı.

Ingestion'ın ürettiği descriptor core profilinin kurallarından geçer. Cookie, path stilleri, `content` parametreleri gibi yeni tel özellikleri **core** profiline girer ve iki dilde birlikte sevk edilir; ingestion onları yalnızca üretir.

## 7. Kabul hedefi

Birincil kabul hedefi kendi backend'imiz `motokurye` (ASP.NET Core 8, Swashbuckle 6.5): 871 operasyon, hiçbirinde `operationId` yok, 37+ özyinelemeli DTO, döngüsel `JToken` şeması, gövdeli hemen her operasyonda dört media type, yalnız `200` belgeli yanıtlar, Swashbuckle'ın görmediği anonim işaretleme. Doküman runtime'da üretiliyor ve şirketin iç API yüzeyi; **repoya girmez**, kabul testi bir env yolu verildiğinde koşar.

Aynı backend'de .NET SDK zaten gömülü (`motokurye` `sk-mcp` dalı). Bu, ikinci bir kabul testi verir: SDK kataloğu ile doküman kataloğu `(method, route)` anahtarıyla eşlenir ve argüman adı, konum, şema ve body modu karşılaştırılır. Beklenen farklar (tool adları, Swashbuckle'ın görmediği header'lar) listelenir; kalan her fark bir hata.

## 8. Reddedilenler

- **`swagger-client`'ı runtime bağımlılığı yapmak.** Serileştirmesi referans alınacak tek doğru implementasyon, ama 6.3 MB ve CommonJS. Mantığı port edilir, bilinen hataları (yalnız ada göre parametre birleştirme, birbirini ezen cookie'ler, karşılanabilir tek requirement yerine bütün scheme'leri uygulamak, `querystring`'i atlamak) düzeltilerek.
- **İlk media type'ı seçmek.** Tool'u kimsenin onun için yazmadığı bir listenin sırasına bağlar; `request-bodies.md`'nin sıralı seçim kuralı kullanılır.
- **Çakışan isimlere `_2` eklemek, `operationId`'yi kesmek.** Mevcut kural: çakışma fatal, operatör `names` override'ıyla çözer.
- **Uzak probe.** §2.
- **Ham MCP token'ını backend'e iletmek.** [uzak-kimlik-karari.md](uzak-kimlik-karari.md).
