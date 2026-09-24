# Uzak Backend'e Kimlik: Scheme Credential'ı ve Token Exchange

**Durum:** kabul edildi — uygulama bu kaydı takip eder
**Tarih:** 24 Eylül 2026
**Kapsam:** `packages/http/spec` (`credentials.md`, `transport.md`), `packages/servers/openapi-mcp`, `motokurye` (`sk-mcp` dalı)
**Kardeş kayıt:** [openapi-kaynak-karari.md](openapi-kaynak-karari.md)

---

## 1. Karar

Gateway uzak backend'i iki yoldan biriyle çağırır, ikisi de operatör config'inde açıkça seçilir:

1. **Scheme credential'ı** — dokümanın her `securityScheme`'i için config'te bir değer. Bütün çağrılar aynı servis kimliğiyle gider.
2. **Token Exchange (RFC 8693)** — çağıranın doğrulanmış MCP token'ı bir yetkilendirme sunucusunda, backend için basılmış bir token'la takas edilir. Kullanıcı kimliği korunur.

Ham MCP token'ını backend'e iletmek **yoktur**, "backend MCP audience'ını da kabul ediyor" beyanıyla bile.

## 2. Neden passthrough yok

Gömülü SDK'da carrier'ı olduğu gibi iletmek güvenli: MCP yüzeyi ile REST yüzeyi aynı süreç, aynı token doğrulayıcı, aynı audience. Gateway'de ikisi ayrı servis:

- Token A'nın `aud`'u gateway. Backend onu kabul ederse audience kontrolü delinmiş olur ([transport.md](../packages/http/spec/transport.md) audience kuralı: `aud == Metadata.Resource`).
- Çalınan bir MCP token'ı gateway'i atlayıp doğrudan backend'e kullanılabilir.
- MCP yetkilendirme spec'i "Token Passthrough"ı açıkça anti-pattern sayar (confused deputy).

"Audience'ı kabul eden backend" seçeneği bu yüzden reddedildi: güvenliği backend'in doğru yapılandırılmış olmasına bırakır ve gateway bunu doğrulayamaz.

## 3. Scheme credential'ı — örnek

```yaml
components:
  securitySchemes:
    ApiKeyAuth: { type: apiKey, in: header, name: X-API-Key }
security: [{ ApiKeyAuth: [] }]
```

```jsonc
{ "credentials": { "ApiKeyAuth": { "fromEnv": "ORDERS_API_KEY" } } }
```

`invoke_tool(get_orders, {page: 2})` → `GET /orders?page=2` + `X-API-Key: <env>`.

Desteklenen şemalar: `apiKey` (header, query, cookie), `http basic`, `http bearer`. Secret config dosyasına yazılmaz, `{fromEnv}` ile bir env değişkenini adlandırır; env yalnız `cli.ts`'te okunur.

**Requirement seçimi.** `security` bir alternatifler listesi: dizi elemanları arasında VEYA, bir eleman içindeki şemalar arasında VE. Gateway **bütün şemalarını karşılayabildiği ilk alternatifi** seçer ve yalnız onu uygular. swagger-js yetkilendirilmiş her şemayı uygular; bu, backend'e istemediği credential'ları gönderir. `security: []` ya da `[{}]` anonim. Hiçbir alternatif karşılanamıyorsa endpoint `security_unsatisfiable` ile düşer.

Kullanıcı bazlı yetki yoktur: backend her çağrıyı servis hesabı olarak görür. stdio modunda tek seçenek budur — stdio'da doğrulanacak bir çağıran token'ı yok.

## 4. Token Exchange — örnek

```text
ajan ──[token A, aud=gateway]──────────────────────────▶ gateway
gateway ──POST /oauth/token
          grant_type=urn:ietf:params:oauth:grant-type:token-exchange
          subject_token=A
          subject_token_type=urn:ietf:params:oauth:token-type:access_token
          audience=<backend>                              ──▶ yetkilendirme sunucusu
yetkilendirme sunucusu ──[token B, aud=backend, sub=aynı kullanıcı]──▶ gateway
gateway ──GET /orders, Authorization: Bearer B──────────▶ backend
```

- Gateway streamable HTTP modunda çalışır, PRM yayımlar, token A'yı doğrular (`oauth4webapi`, JWKS yalnız allowlist'teki host'tan).
- Takası `oauth4webapi` `genericGrantRequest` yapar; kütüphane seçimi [oauth-kutuphane-karari.md](oauth-kutuphane-karari.md).
- Config hangi şemaların (oauth2, openIdConnect, http bearer) takas edilen token'la karşılandığını söyler.
- **Önbellek:** anahtar `sha256(subject) ‖ audience ‖ scope`, ömür `min(expires_in − pay, subject exp)`. Başarısızlık önbelleğe alınmaz. Aynı çağıran için eşzamanlı takaslar tek istekte birleşir (core `SingleFlight`).
- **Doğrulama = takas:** gateway motokurye'nin HS256 token'ını doğrulayacak anahtara sahip değil; token'ı basan yetkilendirme sunucusu takas sırasında doğruluyor. Bu yüzden takas HTTP bearer kapısının verifier'ı.
- **Hata:** reddedilen takas MCP isteğine `401` + `invalid_token` challenge ile döner (istemci yeniden yetkilendirir); erişilemeyen sunucu `500 server_error`. Tool hatası değil — ajan credential'ı onaramaz. Token endpoint'inin gövdesi asla yansıtılmaz.
- Token exchange olmadan HTTP modu çağıran doğrulamaz; o yüzden yalnız loopback host'a bağlanabilir, yoksa operatörün statik credential'ı ağa açılır.
- stdio + token exchange config'i `token_exchange_requires_http` ile açılışta durur.

## 5. motokurye'de ne gerekiyor

`motokurye` `sk-mcp` dalında bir MCP yetkilendirme sunucusu zaten var (`/oauth/{register,authorize,token,revoke}`), ama `/oauth/token` yalnız `authorization_code` ve `refresh_token` kabul ediyor. Bugünkü durum:

- MCP token'ı `tkn=mcp`, `aud = McpResourceIdentity.Resource`, `enc=0`, `gzip=0`, grant'e bağlı `sid` taşıyor.
- Middleware `isMcpToken != isMcpSurface` ise 401 dönüyor: MCP token'ı REST yüzeyinde **reddediliyor**. Doğru davranış — passthrough'u backend tarafında zaten kapatıyor.
- Formatter'lar yalnız `IsSkMcpRequest()` (gömülü sentetik istek) için şifrelemeyi atlıyor. Normal login token'ı `enc=1, gzip=1` taşıdığından gateway'in düz HTTP isteği "Payload must be encrypted" ile reddedilir.

Gereken:

1. `/oauth/token`'a token-exchange dalı: subject geçerli bir MCP token'ı (imza, `aud`, aktif `sid`), takas yetkisi yalnız config'te kayıtlı gateway client'ında.
2. Yeni token türü `tkn=gateway`: `aud = portal.JwtAudience`, `enc=0`, `gzip=0`, aynı `sub` ve `sid`, kısa ömür.
3. Middleware: `tkn=gateway` REST yüzeyinde geçerli, iptali `McpGrantStatusCache.IsActive(sid)` ile (oturum ping'i yerine); `/mcp` yüzeyinde reddedilir.

Şifreleme böylece codec yazmadan çözülür: gateway token'ı şifresiz bir oturum için basılmış olur. Gateway sunucu tarafında TLS arkasında çalışır; payload şifrelemesinin koruduğu tarayıcı kanalı bu yolda yok.

Login akışındaki gizli şifre sonekiyle şifrelemeyi kapatma yoluna **dayanılmaz**: belgelenmemiş bir bypass'ı ürün davranışına bağlamak onu kalıcı kılar.

## 6. Açık kalan

**Login credential'ı** — gateway'in token'ı operatörün yerine bir login endpoint'inden kendisinin alması ve yenilemesi. stdio modunda token exchange olmayan backend'ler için işe yarar. motokurye token exchange ile çözüldüğü için kritik yolda değil; talep gelirse ayrı karar.
