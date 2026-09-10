# Faz 3 — Şema Sadeleştirme + Search-First Keşif

Durum: **tamamlandı** — keşif, isimlendirme, görünürlük ve arama bu fazda bitti ([notlar.md](notlar.md)); şema sadeleştirmesinin pinlenmemiş alanları ve vaat edilen `schema-simplification/` fixture dizini Faz 6'da kapandı ([faz-6 notları](../faz-6-nestjs-sdk/notlar.md), [karar 012](../../kararlar/012-tip-sekli-ve-sema-kural-katmani.md)).

## Hedef

Ürünün kendisi olan iki özelliği kurmak ve C# SDK'yı elle bağlanmış slice'tan gerçek, genelleştirilmiş SDK'ya dönüştürmek:

1. **Şema sadeleştirme pipeline'ı** — Swagger şemasını LLM'in verimli kullanacağı forma indirger.
2. **Search-first keşif üçlüsü** — `search_tools` / `load_tool` / `invoke_tool`; arama sonuçları çağıranın yetkisine göre önceden filtrelenmiş.

## Somut çıktılar

- Spec: `schema-conversion-rules.md` (kurallar mümkün olduğunca **veri tablosu** olarak — her SDK kod değil kural yorumlar) + `search-semantics.md` (BM25 seviyesi skorlama, alan ağırlıkları, kompakt kart formatı).
- Conformance fixture'ları:
  - `schema-simplification/`: wrapper soyma, derinlik sınırı + inline, recursion `$ref`+not, readonly alan düşme — her kural için ayrı çift.
  - `search/`: alaka sıralaması + **auth filtreleme** (aynı sorgu, iki farklı kimlik → farklı sonuç listesi).
- C# SDK genelleştirmesi (`sdks/dotnet/src/SkMcp.AspNetCore`):
  - ApiExplorer (`IApiDescriptionGroupCollectionProvider`) ile endpoint keşfi.
  - `[McpTool]` opt-in attribute'u; description kaynağı XML doc / `[Description]`.
  - Faz 1'in dispatch mekanizması keşfedilen herhangi bir endpoint'e genelleştirilir.
  - Üç meta-tool'un tam implementasyonu.
- DemoApi 8-12 endpoint'e genişletilir: karışık policy'ler, nested/recursive DTO'lar, generic wrapper'lar — fixture'ların gerçek karşılıkları.
- `apps/example-agent-client`: üçlü akışı uçtan uca süren minimal TS MCP client'ı (otomasyon hedefi).
- `packages/core` (TS referans implementasyonu) fırsatçı başlangıç: dönüşüm kuralları stabilleştikçe, fixture'ları elle yazmak yerine üretmek için.

## Bitti kriteri

- Agent, açılmış herhangi bir endpoint'i ara → yükle → çağır akışıyla kullanabiliyor.
- Aynı arama sorgusunda iki farklı kimlik farklı sonuç görüyor; yetkisiz kimlik aramada göremediği tool'u adını tahmin edip çağırdığında pipeline'da reddediliyor (görünürlük ≠ yaptırım, ikisi de test edilmiş).
- C# SDK, `schema-simplification` ve `search` fixture'larının tamamını otomatik testte geçiyor.

## Bu fazda çözülecek açık sorular

- Arama öncesi yetki değerlendirmesi tam istek olmadan nasıl: `IAuthorizationService.AuthorizeAsync`'i endpoint metadata'sındaki policy'lere karşı sentetik principal ile koşmak yeterli mi? Resource-based policy'ler (kaynağa bakan) listeleme anında değerlendirilemez — bunlar için kural ne?
- Arama index'i: in-memory, uygulama açılışında mı kurulur, lazy mi? Endpoint seti runtime'da değişmez varsayımı yeterli mi?
- Kompakt kartın alan/uzunluk bütçesi: description kaç karakterde kesilir, parametre özeti nasıl üretilir?
- `[McpTool]` granülaritesi: yalnız action seviyesi mi, controller seviyesinde toplu açma + tekil hariç tutma da var mı?
