# Faz 1 — Deney Notları

Tarih: 2026-08-28. Ortam: .NET SDK 10.0.400, `ModelContextProtocol.AspNetCore` 2.2.0 (artık stable — plan preview varsayıyordu), `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.11.

## Sonuç: ana bahis kanıtlandı

Sentetik `HttpContext` ile in-process dispatch, `[Authorize]`/policy davranışını birebir koruyor. Aynı üç kimlik, iki yoldan:

| Kimlik                | HTTP `GET /orders/1` | MCP `get_order(id=1)`                     |
| --------------------- | -------------------- | ----------------------------------------- |
| token yok             | 401                  | `{"Status":401}`                          |
| bob (claim yok)       | 403                  | `{"Status":403}`                          |
| alice (`orders.read`) | 200 + body           | `{"Status":200, "Body": ...}` (aynı body) |

MCP tarafı gerçek Streamable HTTP akışıyla test edildi: `initialize` → `notifications/initialized` → `tools/call`, session id yönetimi dahil. `tools/list`, `get_order`'ı `readOnlyHint: true` ile listeliyor (HTTP GET → readOnly eşlemesinin ilk örneği).

## Ne öğrenildi

### 1. Pipeline yakalama hilesi çalışıyor — ayna pipeline gerekmedi

```csharp
app.Use(next => { holder.Pipeline = next; return next; });  // İLK middleware olmalı
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
```

İlk middleware'in `next`'i = sunucunun kendi kullandığı pipeline (routing → authn → authz → endpoint). Kopya/ayna pipeline kurmaya gerek kalmadı; sentetik context **birebir aynı** delegate'ten geçiyor. İki şart:

- Yakalama middleware'i her şeyden önce eklenmeli.
- `UseRouting`/`UseAuthentication`/`UseAuthorization` **açıkça** çağrılmalı — WebApplication'ın otomatik eklemesi yakalama noktasının ÖNÜNE düşer, yakalanan delegate routing'siz kalır (404 yersin).

### 2. Principal kopyalama kararı doğrulandı

`syntheticContext.User = dışMcpİsteği.User` — authentication yeniden koşmuyor. Sentetik istekte Authorization header'ı olmadığından JwtBearer `NoResult` dönüyor ve önceden set edilen principal'a **dokunmuyor**; authorization o principal'a karşı her çağrıda değerlendiriliyor. Challenge/forbid yolları da sentetik response'a doğru yazılıyor (401/403).

### 3. HttpContext.User doldurma (Faz 1 açık sorusunun cevabı)

`IHttpContextAccessor`, MCP tool'unun içinde çalışıyor: Streamable HTTP'de her tool çağrısı bir POST isteği içinde işleniyor ve dış isteğin doğrulanmış principal'ı accessor'dan alınabiliyor. Ekstra tesisat gerekmedi.

### 4. Diğer cevaplanan açık sorular

- **Response yakalama:** `DefaultHttpContext` + `Response.Body = MemoryStream` yeterli; status + body sorunsuz okunuyor. (Streaming/IFormFile bilinçli kapsam dışı.)
- **Middleware sıralaması sürprizi:** `UseHttpsRedirection` sentetik `http` isteğini 307'ye çevirirdi — demo'dan çıkarıldı. Genelleştirmede (Faz 3) "host'un pipeline'ındaki hangi middleware'ler sentetik istekle anlamsız" sorusu var: redirect, CORS preflight, response compression adayları.
- **Recursion riski:** `/mcp` de yakalanan pipeline'ın içinde; ama dispatch hedefi hep API endpoint'i olduğundan sorun çıkmadı. Genelleştirmede `/mcp`'ye dispatch engellenmeli (tek satır path kontrolü).
- **DI scope:** her dispatch `CreateAsyncScope` ile kendi scope'unu alıyor — scoped servisler (DbContext vb.) paralel agent çağrılarında güvenli.

## Faz 2-3'e devreden notlar

- Yakalama hilesi host'tan işbirliği istiyor (middleware sırası). SDK genelleştirilirken bu, `app.MapSkMcp()` benzeri tek çağrının içine saklanmalı; custom middleware'i olan host'larda yakalama noktasının nereye konacağı Faz 3 tasarım sorusu.
- `/mcp` endpoint'i Faz 1'de anonim — kimlik tool çağrısındaki bearer'dan geliyor. Transport sertleştirme (zorunlu auth, OAuth 2.1) Faz 4.
- Demo token endpoint'i (`/auth/token`, sabit imza anahtarı) **yalnız demo** — Faz 5'te örneklerden ayıklanacak uyarısıyla işaretli.

## Kalan bitti kriteri

- [x] Gerçek MCP akışıyla tool çağrısı + kimlik matrisinin HTTP ile birebir eşleşmesi
- [x] Gerçek server (motokurye / SystemSoftBaseServerService) doğrulaması — aşağıda; geçerli-token ayağı kimlik bekliyor

## Sonradan: principal-copy → Identity Carriers geçişi

"Principal kopyalama" kararı (yukarıdaki §2) motokurye bulgusuyla iptal edildi — bkz. [karar 001](../../kararlar/001-kimlik-tasiyicilari.md). Dispatcher [SkMcp.AspNetCore](../../../sdks/dotnet/src/SkMcp.AspNetCore/)'a taşındı; kimlik artık yalnız beyan edilen carrier header'larıyla taşınıyor, JwtBearer sentetik istekte gerçekten yeniden doğruluyor (`NoResult` inceliğine bağımlılık kalktı). DemoApi `AddSkMcp()` + `UseSkMcpCapture()` kullanıyor; S1-S9 test matrisi (14 test) davranış eşitliğini pipeline üzerinden kanıtlıyor.

## Gerçek server doğrulaması (motokurye, 2026-08-28)

Branch: motokurye repo'sunda `sk-mcp/faz-1-dogrulama` (commit `84715c15`). Wiring: `Mcp/SkMcpFaz1.cs` + Program.cs'e üç ekleme. Build ve boot başarılı (macOS, .NET 8 SDK `~/.dotnet`).

Sonuçlar (token'sız ayaklar):

| Senaryo | HTTP `GET /Rest/Presence/GetPortalPresence` | MCP |
| --- | --- | --- |
| token yok | 401 "Missing or invalid Authorization header" | `initialize` transport'ta aynı 401 |
| bozuk token | 401 (IDX12723 decode hatası) | — |
| geçerli token | bekliyor (gerçek kimlik gerekli) | bekliyor |

DemoApi'den farklı çıkan gerçek-dünya bulguları:

1. **Custom auth middleware'de principal kopyalama GEÇERSİZ.** Bu backend `context.User`'ı hiç set etmiyor; kimlik custom `JwtAuthenticationMiddleware` + ambient context'lerle (CurrentUserContext vb.) kuruluyor ve her istekte DB'ye gidiyor. Doğru replay: **Authorization (ve cookie) header'ını sentetik isteğe aynen taşı, middleware gerçekten yeniden koşsun.** Spec'e kural olarak girmeli: standart authentication → principal taşınabilir; custom middleware → header-forwarding replay.
2. **`/mcp` backend'in kendi auth'unun arkasında bırakıldı** (DemoApi'de anonimdi): agent transport seviyesinde de geçerli token taşımak zorunda. Token'sız `initialize` 401 — embedded felsefeyle tutarlı, MCP client'ının header konfigürasyonu gerektirir.
3. **Statik auth metadata'sı yok**: `[Authorize]` sıfır; muafiyet custom `[AllowAnonymous]` (kendi attribute'ları) ile endpoint metadata'sından okunuyor. Faz 3 görünürlük filtresi için "auth'u middleware'de yaşayan backend" senaryosu somutlaştı — `auth.policies` böyle backend'lerde opak (`guard:X` benzeri) kalacak.
4. Ortam sürprizleri: `global.json` SDK 8'e pinli (`latestFeature`); startup process priority yükseltmeye çalışıp macOS'ta çöküyordu (branch'te try/catch'lendi); plugin mimarisi `SystemSoft.CRM.Entity.dll`'i runtime'da `Libraries/`'den istiyor (ayrıca derlenip kopyalandı); init DB'ye bağlanıp ~45 sn sürüyor.
