# sk-mcp — Genel Bakış

## Vizyon

Swagger, bir API'yi insanlara açıklar: endpoint listesi, description'lar, şemalar, deneme arayüzü. sk-mcp aynı katmanı **AI agent'lar** için kurar: mevcut bir backend'in içine gömülen, endpoint'leri MCP (Model Context Protocol) tool'ları olarak keşfedilebilir ve çağrılabilir kılan bir katman.

Fark yaratan üç iddia:

1. **Gömülü (embedded), gateway değil.** SDK backend process'inin içinde yaşar. Tool çağrısı backend'in gerçek request pipeline'ından geçer; backend'in kendi yetki katmanı (guard'lar, policy'ler, `[Authorize]`) hiçbir değişiklik olmadan çalışır. sk-mcp ekstra bir yetki modeli getirmez, mevcidini taşır.
2. **Search-first keşif.** Agent'a 300 tool'luk liste dökülmez. `tools/list` yalnızca meta-tool'lar içerir; agent arar, bulduğunun şemasını yükler, sonra çağırır. Arama sonuçları çağıranın yetkisine göre filtrelenir.
3. **Spec + dil başına SDK.** Davranış dil bağımsız bir spec'te ve conformance fixture'larında tanımlıdır; her SDK (önce C#, sonra NestJS, sonrası açık) aynı fixture setini geçmek zorundadır.

## Mimari kararlar

Bu kararlar tartışılıp kesinleşti; değiştirmek yeni bir tartışma gerektirir.

### 1. Embedded dispatch

Tool çağrısı, backend'in gerçek middleware pipeline'ından geçirilir. C#'ta bu, sentetik `HttpContext` üretip `RequestDelegate`'i in-process invoke etmek demektir (TestServer'ın yaptığına benzer). Sonuçları:

- Guard'lar, filter'lar, model validation — backend'in kendi kodu — aynen çalışır.
- Confused-deputy / token-passthrough problemi tanım gereği yoktur: token zaten bu backend için kesilmiştir, backend kendi doğrular, agent'ın kimliği bozulmadan yetki kontrollerine ulaşır. Ayrık gateway ürünlerinin kronik problemi bizde mimari olarak yok.

### 2. Search-first keşif (v1 çekirdeği, erteleme değil)

`tools/list` yalnızca meta-tool'lar döner: `search_tools`, `load_tool`, `invoke_tool`.

- Tool patlaması çözülür: yüzlerce endpoint agent context'ine asla topluca girmez.
- Client cache sorunu çözülür: liste neredeyse hiç değişmez; değişken olan arama sonuçlarıdır, onlar her seferinde tazedir.
- Arama sonuçları çağıranın yetkisine göre **önceden filtrelenir** — yetkisiz agent'ın endpoint'in varlığını bile görmemesi bilgi sızıntısını önler.
- Kritik ayrım: **görünürlük ≠ yaptırım.** Aramadan gizlemek UX ve sızıntı önlemedir; asıl güvenlik, invoke anında pipeline'daki guard'lardadır. Agent tool adını tahmin etse bile pipeline durdurur.
- Akış: arama kompakt kart döner (isim, description, tek satır parametre özeti) → `load_tool` tam sadeleştirilmiş şemayı getirir → `invoke_tool` çağırır.

### 3. Şema sadeleştirme pipeline'ı

Swagger şeması makine içindir, LLM için değil. Dönüşüm kuralları (spec'te veri olarak tanımlanır):

- Generic wrapper'ları soy (`ApiResponse<T>` → `T`).
- Derinlik sınırı: ~3 seviyeye kadar inline, altı kesilir.
- Recursion `$ref` + tek satır notla kırılır.
- Input şemasından server-computed/readonly alanlar düşülür.
- Kompakt görünüm: önce required alanlar; tamı `load_tool`'da.

### 4. Spec + dil başına SDK

Spec'in tanımladıkları: tool isimlendirme kuralı, metadata çıkarma sözleşmesi, şema dönüşüm kuralları (mümkün olduğunca deklaratif), arama semantiği (BM25 seviyesi, ağır bağımlılık yok), hata eşlemesi, HTTP metodu → `readOnlyHint`/`destructiveHint` eşlemesi.

Drift önleme: dil bağımsız **conformance fixture'ları** (JSON girdi/çıktı çiftleri) [packages/conformance](../packages/conformance)'ta yaşar; her SDK'nın test paketi aynı seti okur ve geçer.

### 5. SDK sırası

C# / ASP.NET Core önce (mevcut bir C# server test yatağı olarak elde). Resmi `ModelContextProtocol` + `ModelContextProtocol.AspNetCore` NuGet paketleri üzerine kurulur; endpoint keşfi ApiExplorer'dan, description'lar XML doc / `[Description]`'dan; açılma `[McpTool]` attribute ile **opt-in**. Sonra NestJS, sonrası açık.

### 6. Transport ve kapsam dışı

- Transport: Streamable HTTP; MCP OAuth 2.1 akışı desteklenir. Backend'ler client'larının nasıl bağlanacağını kendileri belirler — kısıt yok. SDK kendi authentication'ını kurmaz; yalnız RFC 9728 korunan kaynak üstverisini servis eder ve 401'i `resource_metadata` ile dekore eder ([tasima.md](../packages/spec/tasima.md)). Scope'lar tamamen backend'in authorization server'ına delege edilir.
- Bilinçli ertelenenler: web UI (son faz, şimdilik detaysız), response boyutu/truncation stratejisi (ayrı çalışılacak), SSE/file-upload endpoint'leri, rate limiting (backend'in mevcut middleware'ine bırakılır — embedded olduğumuz için zaten pipeline'da çalışır).

## Sıralama stratejisi: dikey slice önce, hemen ardından zorunlu spec çıkarma

Projenin en riskli bahsi tek: **sentetik HttpContext dispatch, auth davranışını gerçekten bozmadan korur mu?** Bu hiç denenmemiş bir mekanizma hakkında spec yazmak saf risktir — yeniden yazılır. O yüzden:

1. Önce dar, elle bağlanmış, genelleştirilmemiş bir uçtan uca slice bu bahsi kanıtlar (Faz 1).
2. Hemen ardından, kapsam genişletmeden önce, öğrenilen davranış dil bağımsız spec parçalarına ve ilk fixture'lara **zorunlu olarak** genellenir (Faz 2). Bu adım atlanırsa spec "C# kodunun düzyazısı"na dönüşür — tam da fixture'ların önlemeye çalıştığı drift.

Spec yazımı boyunca eldeki gerçek C# server, repo içi DemoApi'ye ek ikinci gerçeklik testi olarak kullanılır (co-develop).

## Fazlar

| #   | Faz                                                                        | Tek cümle                                                                        |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | [Walking Skeleton](fazlar/faz-1-walking-skeleton/plan.md)                  | En riskli bahsi kanıtla: embedded dispatch auth'u korur                          |
| 2   | [Spec Çıkarma v0](fazlar/faz-2-spec-cikarma/plan.md)                       | Slice'tan öğrenileni dil bağımsız spec + ilk fixture'lara genelle                |
| 3   | [Şema Sadeleştirme + Search-First](fazlar/faz-3-sema-ve-arama/plan.md)     | Ürünün kendisi: dönüşüm pipeline'ı + auth-filtreli arama üçlüsü                  |
| 4   | [Hata Eşleme, Cache, Transport](fazlar/faz-4-hata-cache-transport/plan.md) | Gerçek backend'e gömülebilirlik: actionable hatalar, per-caller cache, OAuth 2.1 |
| 5   | [C# SDK Sertleştirme + Alpha](fazlar/faz-5-csharp-alpha/plan.md)           | NuGet paketi, quickstart, CI'da conformance gate, spec v1.0                      |
| 6   | [NestJS SDK](fazlar/faz-6-nestjs-sdk/plan.md)                              | Spec'in drift kanıtı: ikinci SDK aynı fixture'ları geçer                         |
| 7   | [Web UI](fazlar/faz-7-web-ui/plan.md)                                      | Placeholder                                                                      |

Paket yerleşimi: [paket-yerlesimi.md](paket-yerlesimi.md)
