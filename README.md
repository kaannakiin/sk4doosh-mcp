# sk-mcp

Ajanlar için Swagger. Mevcut bir backend'e gömülen bir MCP katmanı: endpoint'lerinizi arama-öncelikli bir tool kataloğu olarak açar, çağrıyı backend'in **kendi pipeline'ından** geçirir. Yaptırım nerede yaşıyorsa orada kalır — sk-mcp yetki mantığını ne kopyalar ne de yeniden yazar.

Spec dilden bağımsızdır; her dil kendi SDK'sını aynı fixture korpusuna karşı doğrular.

- Ne olduğu ve neden: [docs/00-genel-bakis.md](docs/00-genel-bakis.md)
- Nasıl çalışıyor (yaptırım vs görünürlük): [docs/nasil-calisiyor.md](docs/nasil-calisiyor.md)
- Paket sınırları: [docs/paket-yerlesimi.md](docs/paket-yerlesimi.md)
- Kararlar: [docs/kararlar/](docs/kararlar/) · Fazlar: [docs/fazlar/](docs/fazlar/)

## Repo haritası

| Yol                                                    | Rol                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [packages/spec](packages/spec)                         | Normatif spec: Türkçe metin + `schemas/*.schema.json`. Tüm diller için tek doğruluk kaynağı |
| [packages/conformance](packages/conformance)           | Saf JSON fixture korpusu (7 tür, 105 fixture) + `validate.mjs`                              |
| [packages/core](packages/core)                         | TS referans implementasyonu; spec tipleri üretilir, elle yazılmaz                           |
| [sdks/dotnet](sdks/dotnet)                             | C# SDK — `SkMcp.AspNetCore`, public alpha ([README](sdks/dotnet/README.md))                 |
| [sdks/nestjs](sdks/nestjs)                             | NestJS SDK — istek katmanı hazır, keşif/arama Faz 6'da                                      |
| [packages/excel-mcp](packages/excel-mcp)               | Bağımsız, yayınlanmış ürün: yerel Excel dosyalarını okuyan MCP sunucusu                     |
| [apps/example-agent-client](apps/example-agent-client) | Senaryolu MCP istemcisi (smoke, validation-retry, error-envelope)                           |

`packages/eslint-config` ve `packages/typescript-config` iç yapılandırma paketleridir.

## Build ve test

```bash
pnpm install
pnpm build          # turbo run build
pnpm lint           # lint + conformance fixture doğrulaması
pnpm check-types
```

TS testleri: `pnpm --filter @sk-mcp/core test`, `pnpm --filter @sk-mcp/sdk-nestjs test` (Vitest).
C# tarafı: `pnpm turbo run test --filter=@sk-mcp/sdk-dotnet` (net8.0 + net10.0).

Spec tipleri üretilir: şemayı değiştirin, `pnpm turbo run gen` koşun. `packages/core/src/generated/` ve `sdks/dotnet/src/SkMcp.AspNetCore/Generated/` elle düzenlenmez.

## Lisans

MIT — [LICENSE](LICENSE).
