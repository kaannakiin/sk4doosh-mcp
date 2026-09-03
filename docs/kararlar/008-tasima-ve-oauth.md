# Karar 008 — Taşıma ve OAuth 2.1

Tarih: 2026-09-02. Durum: **kabul edildi** — Faz 4 uygulaması bu kararı takip eder.

## Cetvel uygulaması

[Karar 003](003-istek-ustverisi.md)'ün cetveli uygulanınca SDK başına **tek yeni option grubu** (`ResourceServer`) çıkar. Session-mode/Origin/authorization zorunluluğu için ayrı bir düğme **eklenmez**, çünkü ASP.NET ve Express bunlar için zaten birinci sınıf idiom sunar (`services.Configure<HttpServerTransportOptions>(...)`, `.RequireAuthorization()`, CORS middleware, `hostHeaderValidation()`). sk-mcp yalnız **tek doğru cevabı olan ve idiomu olmayanı** ekler: RFC 9728 metadata yolu, ASP.NET authentication kurulu olmadan da çalışan 401 `resource_metadata` dekorasyonu, `tools/list_changed` fan-out'u, audience kuralı.

sk-mcp **asla** `AddAuthentication`/`AddMcp` (ya da Nest eşdeğerini) çağırmaz; yaptırım her zaman host'un elindeki mekanizmadır — `JwtBearer` + `.RequireAuthorization()`, custom middleware, ya da bunların hiçbiri. Scope tamamen delege edilir (`ScopesSupported` passthrough, sk-mcp içeriğine bakmaz). Audience için soyutlama yoktur: kural + test + doküman verilir, `JwtBearer`'ın zaten sahip olduğu `ValidAudience` mekanizmasına ne yazılacağı söylenir, yeni bir doğrulama katmanı kurulmaz.

Ayrıntılı normatif kurallar: [tasima.md](../../packages/spec/tasima.md).

## Reddedilen alternatifler

- **Kendi session registry'si.** SDK'nın tek slotlu `RunSessionHandler`/`ConfigureSessionOptions`'ını gasp edip kendi oturum kaydını tutmak, SDK'nın zaten yaptığı `listChanged` fan-out'unu yeniden yazmak anlamına gelirdi — iki paralel oturum kaynağı, biri diğerinden habersiz kalabilir. `McpServerOptions.ToolCollection.Changed` üzerinden SDK'nın kendi bildirim mekanizmasını tetiklemek tercih edildi.
- **Origin/DNS-rebinding middleware'i.** Bu, host'un CORS politikasının parçasıdır; sk-mcp burada bir varsayım dayatırsa host'un kendi (muhtemelen daha katı) politikasıyla çakışabilir. Ayrıca bearer token zorunluysa DNS-rebinding saldırısı zaten token'a erişemez — middleware'in kazandırdığı ek güvenlik marjinaldir. Nest tarafında zaten idiomatik bir çözüm vardır (`hostHeaderValidation()`), .NET'te host kendi CORS middleware'ini kurar.
- **`AddAuthentication` sarmalayıcısı.** sk-mcp bir authentication scheme'i dayatırsa, o scheme'i kurmayan (motokurye gibi custom middleware kullanan) backend'lerde sk-mcp'nin kendi auth'u host'unkiyle çakışır ya da onu gölgeler. sk-mcp'nin "backend'in kendi pipeline'ını, hiçbir değişiklik olmadan, aynen kullan" temel iddiası ([docs/00-genel-bakis.md](../00-genel-bakis.md) madde 1) burada da geçerlidir.
- **Authorization server metadata'sını aynalama.** Nest SDK'sının `mcpAuthMetadataRouter`'ı authorization server metadata'sını da resource origin'inde yayınlayabiliyor; sk-mcp kendi 12 satırlık PRM handler'ı için bunu **yapmaz** — AS metadata'sı, `authorization_servers`'ın işaret ettiği AS'in kendi sorumluluğudur. Aynalamak "scope tamamen delege edilir" ilkesine aykırı düşerdi.
- **`RequireAuthorization` düğmesi.** `MapSkMcp` zaten bir `IEndpointConventionBuilder` döner; host `.RequireAuthorization()`'ı üzerine zaten ekleyebilir. Ayrı bir `options.RequireAuth = true` düğmesi, ASP.NET'in kendi idiomunu tekrar etmekten başka bir şey kazandırmazdı — doküman + DemoApi örneği yeterli.

## Repo içi authorization server gerekçesi

Faz 4'ün OAuth akışını **üç** bitiş kriterinde de (DemoApi, xunit `TestServer`, Nest demo) uçtan uca doğrulaması gerekiyor — dış bir servise (Keycloak, Duende, Auth0) bağımlı olmak CI'da ve geliştirici makinesinde Docker/ağ bağımlılığı demek. Karar: demo authorization server **repo içi, process-içi** çalışır — DemoApi'de aynı Kestrel process'ine map'lenen bir class library (`sdks/dotnet/samples/DemoAuthServer/`), xunit'te aynı `TestServer`'a map'lenir (resource server + authorization server tek `HttpClient` arkasında), Nest demo'da SDK'nın kendi `mcpAuthRouter`'ı + in-memory provider. Docker yok, dış servis yok.

**Keycloak notu:** harici bir authorization server (Keycloak, Duende IdentityServer, Auth0, ...) yalnız "prod'da böyle bağlanırsınız" dokümanı olarak geçer — `ResourceServer.Metadata.AuthorizationServers` ve host'un `JwtBearer`/verifier ayarları harici bir AS'i sorunsuz kabul eder, çünkü sk-mcp AS'in kendisiyle hiç konuşmaz, yalnız `aud`/`resource` uyumuna bakar. Repoya bir Keycloak kurulumu **girmez**.

## Motokurye bulguları

Motokurye'nin `AddAuthentication` kurmadığı, kimliğin `JwtAuthenticationMiddleware` adlı custom bir middleware'de yaşadığı (karar 003, karar 007) zaten biliniyordu; taşıma katmanı için bunun sonucu: PRM endpoint'i ve 401 dekorasyonu **ASP.NET authentication kurulu olmadan da** çalışmak zorunda — `ResourceServerMiddleware` her iki host şeklinde de ilk middleware olarak (`UseSkMcpCapture()`'a ek) kurulur, `JwtAuthenticationMiddleware`'den ve varsa `UseAuthentication`'dan **önce** çalışır. Motokurye'de doğrulanabilenler: PRM servis edilir (`Metadata` yoksa 404), anonim `initialize` → 401 + motokurye'nin kendi gövdesi + sk-mcp'nin eklediği `WWW-Authenticate`, geçerli bearer → üç meta-tool, `search_tools` dolu sonuç döner, `load_tool`, güvenli (GET) bir `invoke_tool` → 200, geçersiz token → 401. **Doğrulanamayan:** tam OAuth akışı — motokurye'nin kendi authorization server'ı yok; bu adım host tarafında dokümante edilir (AS geldiğinde `ResourceServer.Metadata.{Resource, AuthorizationServers}` set edilir, AS'in bastığı token'ın `aud`'u motokurye'nin `JwtTokenHelper`'ının kabul ettiği audience'la örtüşmelidir; `JwtAuthenticationMiddleware`'in kendisi değişmez, PRM ondan önce servis edilir).
