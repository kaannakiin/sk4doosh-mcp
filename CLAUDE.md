# sk-mcp

"Agent'lar için Swagger": mevcut backend'lere gömülen MCP katmanı — spec + dil başına SDK. Mimariyi anlamadan kod yazma: [docs/00-genel-bakis.md](docs/00-genel-bakis.md), [docs/nasil-calisiyor.md](docs/nasil-calisiyor.md), [docs/paket-yerlesimi.md](docs/paket-yerlesimi.md). Faz planları ve notları: [docs/fazlar/](docs/fazlar/).

## Paket sınırları

| Paket                   | Rol                                                                  | Kural                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/spec`         | Normatif spec: Türkçe prose + `schemas/*.schema.json`                | Runtime kod eklenmez; şemalar TÜM dillerin tek tip kaynağıdır                                                                                                           |
| `packages/conformance`  | Saf JSON fixture korpusu + `validate.mjs`                            | SDK'lar JSON'u path'ten okur; buraya runtime bağımlılığı eklenmez                                                                                                       |
| `packages/core`         | TS referans implementasyonu (composer/template runtime dahil)        | Spec kavramları için tipler `pnpm gen` ile ÜRETİLİR; elle tip yazılmaz                                                                                                  |
| `packages/info-scraper` | Genel amaçlı yardımcı paket — sk-mcp spec/core alanına bağımlı değil | Spec/core'a bağımlılık eklenmez; bağımsız geliştirilir                                                                                                                  |
| `sdks/*`                | Dil SDK'ları (dotnet, nestjs)                                        | `packages/` altına SDK koyma; NestJS sentetik bağlamı SDK kurar — `light-my-request` YASAK (Express'i zehirliyor, [karar 004](docs/kararlar/004-nestjs-dogrulamasi.md)) |

## Değişmez kurallar

- **Tek tip kaynağı**: spec kavramları (EndpointDescriptor, ToolDefinition, Fixture, Auth...) için TS/C# tipi elle yazma. Şemayı değiştir → `pnpm turbo run gen` → üretilen tip. `packages/core/src/generated/` dosyalarına elle dokunma; commit'lenirler.
- `packages/core/src/index.ts` yalnız kanonik dosyadan `export type` yapar; `generated/fixture.ts` içindeki gömülü EndpointDescriptor/ToolDefinition kopyalarını asla re-export etme (tek-tanım kuralı).
- Şemalarda `$id` ≡ dosya adı; 2020-12'nin şu keyword'leri kullanılmaz: `prefixItems`, `unevaluatedProperties`, `$dynamicRef`, `dependentSchemas` (codegen desteklemiyor).
- Şema değişikliği fixture'ları kırarsa ikisi aynı değişiklikte güncellenir.
- **Yorum yasağı**: kodda/JSON'da yorum satırı yok; açıklama spec prose'una ya da docs'a yazılır.
- **Dil**: prose dökümanlar Türkçe; makine-okur her şey (JSON alanları, tool adları, kod tanımlayıcıları) İngilizce.
- core'u her zaman turbo üzerinden derle (`pnpm turbo run build`) — `pnpm --filter @sk-mcp/core run build` gen'i atlar, stale tip riski.
- Tool isimlendirmede sessiz çakışma çözümü yasak: çakışma = hata ([packages/spec/isimlendirme.md](packages/spec/isimlendirme.md)).
- Görünürlük ≠ yaptırım: arama filtrelemesi güvenlik değildir; yaptırım her zaman invoke'ta backend pipeline'ındadır.

## Komutlar

- `pnpm build` / `pnpm lint` (validate dahil) / `pnpm check-types` / `pnpm validate`
- TS testleri: `pnpm --filter @sk-mcp/core test` / `pnpm --filter @sk-mcp/sdk-nestjs test` (vitest)
- dotnet tarafı: `pnpm turbo run build --filter=@sk-mcp/sdk-dotnet` (shim `dotnet build` çağırır)
- DemoApi: `dotnet run` — `sdks/dotnet/samples/DemoApi` içinde; MCP endpoint `/mcp`, demo token `POST /auth/token {"user":"alice"|"bob"}`
- Nest demo: `sdks/nestjs/samples/demo-api` içinde `node dist/main.js` (önce `pnpm turbo run build --filter=@sk-mcp/demo-nestjs`); aynı `/mcp` + `/auth/token` sözleşmesi
