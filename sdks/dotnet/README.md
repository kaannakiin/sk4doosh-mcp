# SkMcp.AspNetCore

Mevcut ASP.NET Core backend'inize gömülen bir MCP katmanı. Endpoint'lerinizi ajanlara arama-öncelikli bir tool kataloğu olarak açar; çağrıyı **kendi pipeline'ınızdan** geçirir, böylece kimlik doğrulama ve yetkilendirmeniz hiç değişmeden çalışmaya devam eder. Gateway değil, kopya iş mantığı değil.

Mimari ve tasarım gerekçeleri: [docs/00-genel-bakis.md](../../docs/00-genel-bakis.md), [docs/nasil-calisiyor.md](../../docs/nasil-calisiyor.md).

> Statü: `0.1.0-alpha.1`. Public API bu sürümde sabitlendi ama alpha; kırıcı değişiklik olabilir.

## Gereksinimler

- `net8.0` veya `net10.0` hedefleyen bir ASP.NET Core Web API proje
- Controller ya da minimal API endpoint'leri (keşif ApiExplorer üzerinden yapılır)

## 1. Kurulum

Alpha yerel bir nupkg beslemesinden dağıtılıyor; nuget.org'da yok.

```bash
# sk-mcp deposunda
pnpm turbo run pack --filter=@sk-mcp/sdk-dotnet
# → sdks/dotnet/local/nupkg-feed/SkMcp.AspNetCore.0.1.0-alpha.1.nupkg
```

```bash
# kendi projenizde
dotnet nuget add source /mutlak/yol/sk-mcp/sdks/dotnet/local/nupkg-feed --name sk-mcp-local
dotnet add package SkMcp.AspNetCore --version 0.1.0-alpha.1
```

`ProjectReference` ile bağlamayın: SkMcp çok hedefli (`net8.0;net10.0`) ve `ProjectReference` restore sırasında tüm hedefleri değerlendirir. `global.json` ile eski bir SDK pinleyen host'ta bu `NETSDK1045` verir. Paket yolu bu sorunu yaşamaz, host'un SDK'sı hangi hedefi kurabiliyorsa onu seçer.

## 2. Bağlama — üç çağrı

```csharp
using SkMcp.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddSkMcp();

var app = builder.Build();

app.UseSkMcpCapture();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapSkMcp("/mcp");

app.Run();
```

Mevcut `AddAuthentication`/`AddAuthorization` kurulumunuza dokunmayın — SkMcp kendi kimlik şeması kurmaz, sizinkini kullanır.

> **Sıra kritik.** `UseSkMcpCapture()` pipeline'ın **o noktadan sonrasını** yakalar ve ajan çağrılarını oraya sokar. `UseRouting`/`UseAuthentication`/`UseAuthorization`'dan **önce**, mümkün olan en erken yere koyun. Sonrasına koyarsanız ajan istekleri kimlik doğrulama katmanınızı hiç görmez. `UseSkMcpCapture()`'ı tamamen unutursanız `MapSkMcp()` startup'ta hata fırlatır.

## 3. Hangi endpoint'ler görünür olur?

Varsayılan **opt-in**: hiçbir endpoint açılmaz, `[McpTool]` ile işaretlediğiniz açılır.

```csharp
using SkMcp.AspNetCore.Discovery;

[ApiController]
[Route("orders")]
[McpTool]
public sealed class OrdersController : ControllerBase { }
```

Yüzlerce endpoint'i olan bir backend'de attribute yolu pratik değil; opt-out'a geçin ve tekil istisnaları `[McpIgnore]` ile kapatın:

```csharp
builder.Services.AddSkMcp(options =>
{
    options.Selection.Default = SelectionDefault.Include;
});
```

Görünürlük bir güvenlik mekanizması **değildir**. Katalogdan gizlenen bir tool yine de yalnız backend'iniz izin verirse çalışır; yaptırım her zaman invoke anında sizin pipeline'ınızdadır.

## 4. Bir MCP client'ı bağlamak

Endpoint Streamable HTTP konuşur. `tools/list` yalnız üç meta-tool döndürür:

| Tool           | İş                                 |
| -------------- | ---------------------------------- |
| `search_tools` | Doğal dil sorgusuyla endpoint arar |
| `load_tool`    | Tek bir tool'un tam şemasını verir |
| `invoke_tool`  | Tool'u çağırır                     |

Katalog `tools/list`'e dökülmez: 700 endpoint'lik bir backend'de bu ajanın context'ini boğar. Ajan önce arar, sonra yükler, sonra çağırır.

`/mcp`'yi korumak isterseniz kendi authorization'ınızı takın:

```csharp
app.MapSkMcp("/mcp").RequireAuthorization();
```

Depodaki `apps/example-agent-client` hazır bir istemci: `node apps/example-agent-client/dist/main.js --scenario smoke`.

## 5. Sorun giderme

| Belirti                                                    | Sebep                                                                       | Çözüm                                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Startup'ta `MapSkMcp() requires app.UseSkMcpCapture()...`  | Capture hiç çağrılmadı                                                      | `app.UseSkMcpCapture()` ekleyin, routing'den önce                                                       |
| `sk-mcp pipeline is not captured` (ilk tool çağrısında)    | Capture kayıtlı ama host henüz istek görmedi                                | Host'u başlatın; kalıcıysa capture'ın konumunu kontrol edin                                             |
| Tool'lar çalışıyor ama yetki kontrolü hiç devreye girmiyor | Capture, `UseAuthentication`/`UseAuthorization`'dan **sonra**               | Capture'ı pipeline'ın başına taşıyın                                                                    |
| `search_tools` her zaman boş                               | `Selection.Default` varsayılanı `Exclude`, hiçbir yere `[McpTool]` konmamış | `[McpTool]` ekleyin ya da `Selection.Default = Include` yapın                                           |
| `/mcp`'ye her istek 401                                    | `.RequireAuthorization()` var, client token göndermiyor                     | Bearer token gönderin ya da geliştirme sırasında `.RequireAuthorization()`'ı kaldırın                   |
| Startup'ta fatal tanı ile host açılmıyor                   | Katalog kurulumunda `name_collision` / `invalid_name` gibi hata             | Log'daki kod listesini okuyun; gerekirse `options.Diagnostics.Downgrade` ile tekil kodu uyarıya indirin |

## 6. Sırada ne var

- Büyük, mevcut bir backend'e ekleme: [docs/gercek-backend-entegrasyonu.md](../../docs/gercek-backend-entegrasyonu.md)
- Genişletme noktaları (cache, görünürlük, hata eşlemesi): [docs/kararlar/006-genisletme-noktalari.md](../../docs/kararlar/006-genisletme-noktalari.md)
- Örnek: [samples/DemoApi](samples/DemoApi) — policy, rol, imperatif sahiplik kontrolü ve anonim endpoint'ler tek controller'da
