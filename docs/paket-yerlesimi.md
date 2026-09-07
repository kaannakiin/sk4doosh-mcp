# Paket Yerleşimi

## Hedef ağaç

```text
sk-mcp/
├── apps/                     # Faz 3'e kadar boş (sonra example-agent-client; web yalnız Faz 7)
├── packages/                 # paylaşılan çekirdek + bağımsız yayınlanabilir ürün paketleri — SDK yok
│   ├── spec/                 # @sk-mcp/spec — normatif markdown + JSON kural tabloları (kod yok)
│   ├── conformance/          # @sk-mcp/conformance — saf JSON fixture korpusu (runtime bağımlılığı yok)
│   ├── core/                 # @sk-mcp/core — TS referans implementasyonu (Faz 3+'ta doldurulur)
│   ├── excel-mcp/            # @sk-mcp/excel-mcp — bağımsız MCP sunucusu (core'a bağımlı değil)
│   ├── eslint-config/        # @sk-mcp/eslint-config
│   └── typescript-config/    # @sk-mcp/typescript-config
├── sdks/                     # TÜM SDK'lar burada, dilden bağımsız (rol bazlı ayrım)
│   ├── dotnet/               # package.json shim: build/test/lint → dotnet komutları; kendi turbo.json'u
│   │   ├── SkMcp.sln
│   │   ├── src/SkMcp.AspNetCore/
│   │   ├── samples/DemoApi/          # Faz 1'in demo backend'i
│   │   └── tests/SkMcp.Tests/        # fixture'ları packages/conformance'tan okur
│   └── nestjs/               # Faz 6 — @sk-mcp/sdk-nestjs, TS-native pnpm paketi
├── pnpm-workspace.yaml       # packages: ["apps/*", "packages/*", "sdks/*"]
└── turbo.json
```

## Ayrım ilkesi: rol bazlı

- `packages/` = paylaşılan çekirdek (spec, fixture'lar, referans implementasyon, config'ler) **ve** bağımsız yayınlanabilir ürün paketleri.
- `sdks/` = tüm SDK'lar, dil fark etmeksizin. `sdks/*` workspace globunda olduğundan TS SDK'lar (nestjs) orada da native pnpm paketidir; dotnet gibi yabancı toolchain'ler package.json shim'iyle girer.

## Ürün paketleri (`excel-mcp` ve devamı)

`packages/excel-mcp` (ve gelecekte `packages/pdf-mcp`) ne SDK ne de çekirdek: kendi başına `npx` ile kurulan, kendi semver'i olan, MCP sunucusu olan **ürün paketleri**. `packages/` altında durmalarının sebebi `sdks/`'in rolünün "mevcut bir backend'e gömülen dil SDK'sı" olması — bu paketlerin gömüleceği bir backend yok.

Çekirdekten üç farkı vardır ve üçü de bilinçlidir:

- `private: true` **değildir**; gerçek semver taşır (`0.1.0`), `bin` + `files` + `publishConfig.access: public` beyan eder.
- `exports.types` `./src/index.ts` yerine `./dist/index.d.ts`'e bakar. İç konvansiyon dış tüketicide çalışmaz: `src` yayınlanmaz ve dış tüketicinin `tsc`'si bizim compiler option'larımıza sahip değildir. Aynı sebeple `declarationMap` kapalıdır — açık olsaydı yayınlanan her `.d.ts.map` kırık referans olurdu.
- `packages/core`'a bağımlı olmak zorunda değildir. `excel-mcp` değildir: `EndpointDescriptor` HTTP `method` + `route` zorunlu kılar, dosya okuyan bir sunucunun replay edeceği pipeline yoktur.

## Neden spec / conformance / core üç ayrı paket?

Üçünün okuyucusu, değişim hızı ve tüketim modeli farklı:

| Paket         | Okuyucu                                        | Tüketim                                                                            |
| ------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `spec`        | insan (sen, katkıcılar)                        | prose diff olarak review edilir                                                    |
| `conformance` | her SDK'nın test framework'ü                   | JSON doğrudan okunur — **Node/pnpm gerektirmez**, `dotnet test` tek başına çalışır |
| `core`        | TS runtime (NestJS SDK'nın gerçek bağımlılığı) | import edilir                                                                      |

`core`'un üç görevi: (a) fixture'ları elle yazmak yerine gerçek mantıktan deterministik üretmek (elle yazılan fixture'lar iç tutarsızlığa kayar), (b) NestJS SDK'nın sıfırdan yazmayacağı üretim bağımlılığı olmak, (c) spec'in çalıştırılabilir dokümantasyonu. Faz 1-2'de zorlanmaz; dönüşüm kuralları stabilleşince (Faz 3 civarı) fırsatçı şekilde doldurulur — önce C#'ın elle türetilmiş fixture'ları kaynak gerçektir, referans implementasyon onlara yetişir.

`spec` ve `conformance` için minimal package.json yeterlidir (`{"private": true}`, build script'i yok — turbo, task'ı olmayan paketi atlar).

## dotnet'in pnpm/turbo ile ortak yaşaması

`sdks/dotnet/package.json` shim'i:

```json
{
  "name": "@sk-mcp/sdk-dotnet",
  "private": true,
  "scripts": {
    "build": "dotnet build",
    "test": "dotnet test",
    "lint": "dotnet format --verify-no-changes"
  }
}
```

- dotnet'e özgü output'lar (`bin/**`, `obj/**`) kök turbo.json'u kirletmemek için `sdks/dotnet/turbo.json`'da (package-level config) tanımlanır.
- Reddedilen alternatifler: **ayrı repo** (solo geliştirici için submodule/copy senkronu saf yük; spec+fixture ayrımının amacı drift'i aynı PR/CI koşusunda yakalamak — bu ortak yerleşim gerektirir), **turbo'ya özel dotnet orkestrasyonu** (shim aynı sonucu daha az araçla verir).

## Fixture tüketimi (C#): kopya değil, path referansı

`tests/SkMcp.Tests/SkMcp.Tests.csproj` içinde MSBuild link'i:

```xml
<None Include="../../../packages/conformance/**/*.json"
      Link="Fixtures\%(RecursiveDir)%(Filename)%(Extension)"
      CopyToOutputDirectory="PreserveNewest" />
```

Build-time kopya test output dizinine gider (xUnit runtime'da dosya okur); source-controlled kopya yoktur. Tek kaynak: `packages/conformance`.

Fixture dizin yapısı (Faz 2'den itibaren dolar):

```text
packages/conformance/
├── naming/*.json
├── metadata-extraction/*.json
├── schema-simplification/*.json
├── card/*.json
├── search/*.json
└── error-mapping/*.json
```

## İsimlendirme: @repo → @sk-mcp, hepsi birden — YAPILDI (Faz 2)

Tüm paketler `@sk-mcp/*` scope'una geçer — config paketleri dahil (yarım scope, "hangisi @repo hangisi @sk-mcp" kafa karışıklığı üretir). Şu an sıfır dış tüketici, tek commit'lik repo — rename'in en ucuz anı. Notlar:

- Yayın engeli scope değil `private: true`'dur; hep içeride kalacaklar (`eslint-config`, `typescript-config`, `spec`, `conformance`) scope'tan bağımsız private kalır. Scope'un gerçekten önemli olduğu paketler ileride publish edilebilecek olanlar: `core`, `sdk-nestjs`.
- npm'de `@sk-mcp` scope müsaitliği rename'den önce kontrol edilir.

Rename listesi: `@repo/core` → `@sk-mcp/core`; `@repo/eslint-config` → `@sk-mcp/eslint-config`; `@repo/typescript-config` → `@sk-mcp/typescript-config`; tüm iç referanslar (package.json dependency'leri, eslint.config.js import'ları, tsconfig extends yolları).

## apps/ kararı

- Faz 3'e kadar boş.
- Faz 3'te `apps/example-agent-client`: `search_tools`/`load_tool`/`invoke_tool` akışını Claude Desktop'a/inspector'a bağımlı olmadan uçtan uca smoke-test eden minimal TS MCP client'ı. Meşru pnpm/turbo-native app, iyi otomasyon hedefi.
- `apps/web` kesinlikle Faz 7'ye kadar scaffold edilmez.

## Ayrı repo'ya geçiş yolu (şimdi kurulmaz, not edilir)

C# SDK ileride kendi release kadansını/issue tracker'ını isterse: `sdks/dotnet` kendi repo'suna çıkarılır, fixture'ları git submodule ile değil, spec tag'leriyle kilitli versiyonlanan bir NuGet content paketi (ör. `SkMcp.ConformanceFixtures`) üzerinden tüketir.
