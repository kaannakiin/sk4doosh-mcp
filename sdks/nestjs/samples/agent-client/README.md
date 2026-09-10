# agent-client

`search_tools` → `load_tool` → `invoke_tool` akışını gerçek bir MCP client (`@modelcontextprotocol/sdk`) ile koşturan, "bitti kriteri"ni otomatikleştiren küçük bir CLI. `sdks/dotnet/samples/DemoApi` ve Nest demo'suna karşı çalışır; `SKMCP_AUTH=bearer` ile herhangi bir sk-mcp backend'ine karşı da kullanılabilir.

## Kurulum ve build

Kökten:

```sh
pnpm install
pnpm turbo run build --filter=@sk-mcp/agent-client
```

## Ortam değişkenleri

| Değişken         | Varsayılan              | Açıklama                                                           |
| ---------------- | ----------------------- | ------------------------------------------------------------------ |
| `SKMCP_BASE_URL` | `http://127.0.0.1:5178` | Backend'in kök URL'i; MCP endpoint'i `{base}/mcp` olarak çağrılır. |
| `SKMCP_USER`     | `alice`                 | Demo kullanıcı adı (`token`/`oauth` modlarında `login_hint`).      |
| `SKMCP_AUTH`     | `oauth`                 | `oauth` \| `token` \| `bearer`.                                    |
| `SKMCP_TOKEN`    | —                       | Yalnız `SKMCP_AUTH=bearer` iken zorunlu, hazır bir access token.   |

## Auth modları

- **`oauth`** (varsayılan): `src/headless-oauth-provider.ts`, `@modelcontextprotocol/sdk`'nın `OAuthClientProvider`'ını bellek-içi uygular. `StreamableHTTPClientTransport` ile ilk bağlantı denemesi `UnauthorizedError` fırlatır; provider'ın `redirectToAuthorization` metodu authorization URL'ine `login_hint=<SKMCP_USER>` ekleyip `redirect: "manual"` ile fetch eder, `Location` header'ından authorization code'u yakalar. Ardından `transport.finishAuth(code)` çağrılır ve aynı provider ile yeni bir transport üzerinden yeniden bağlanılır. Demo authorization server auto-consent yaptığı için akış tamamen headless'tır.
- **`token`**: `POST {base}/auth/token {"user": SKMCP_USER}` → `{ access_token }`; token, her istekte statik `Authorization: Bearer` header'ı olarak taşınır. Bugünkü DemoApi kısayoludur.
- **`bearer`**: `SKMCP_TOKEN`'ı olduğu gibi statik bearer olarak kullanır — motokurye gibi gerçek bir backend'e karşı, kendi token'ınızla çalıştırmak içindir.

Bağlantı kurulamazsa (yanlış/eksik token, OAuth akışı tamamlanamadı, vb.) süreç **exit code 3** ile çıkar.

## Senaryolar

```
node dist/main.js --scenario <smoke|validation-retry|error-envelope> [--tool <name>] [--query <q>] [--arguments <json>]
```

Eski pozisyonel biçim (`<query> [tool] [argumentsJson]`) hâlâ çalışır ve `smoke` senaryosuna eşlenir.

- **`smoke`**: `tools/list`'in üç meta-tool'u içerdiğini, `search_tools` (varsayılan sorgu `"sipariş"`), `load_tool` ve `invoke_tool`'un (varsayılan argüman `{}`) çalıştığını doğrular; her adımı bir checklist tablosunda basar. Sonuç `isError` değilse ve `status < 400` ise **exit 0**, aksi halde **exit 1**.
- **`validation-retry`**: `search_tools` (varsayılan sorgu `"create order"`) ile başlar, `--tool` verilmediyse required alanlı ilk sonucu seçer; şemadan **bilerek geçersiz** argümanlar üretir (`string → ""`, `integer`/`number → 0`, `boolean → false`, yalnız required alanlar). İlk `invoke_tool` çağrısının `isError: true`, `error: "validation_failed"`, en az bir `fields` girdisi taşıdığını ve hiçbir mesajın sızıntı içermediğini doğrular. Sonra **yalnızca dönen `fields` payload'ından** düzeltilmiş argümanlarla (`string → "sample"`, `integer`/`number → 1`, `boolean → true`) ikinci bir `invoke_tool` çağrısı yapar; `!isError` ve `2xx` beklenir. Her iki payload da yazdırılır. Başarı **exit 0**.
- **`error-envelope`**: `--tool` ve `--arguments` ile doğrudan `invoke_tool` çağırır (backend-agnostic; motokurye gibi başka bir backend'e karşı da kullanılabilir). `isError: true`, `error`'un dokuz backend kodundan ya da sekiz SDK kodundan biri olduğunu, backend kodlarında `status`'un var olduğunu, mesajın boş ve sızıntısız olduğunu doğrular. Başarı **exit 0**.

## Exit kodları

| Kod | Anlam                                                          |
| --- | -------------------------------------------------------------- |
| 0   | Senaryo geçti.                                                 |
| 1   | Bir doğrulama (assertion) başarısız oldu.                      |
| 2   | Kurulum sorunu: sorguya uyan tool yok, `load_tool` hata döndü. |
| 3   | Auth hatası: bağlantı/oturum kurulamadı.                       |

## Çalıştırma örnekleri

DemoApi'ye karşı (varsayılan OAuth akışı):

```sh
cd sdks/dotnet/samples/DemoApi && dotnet run &
SKMCP_AUTH=oauth SKMCP_USER=alice node sdks/nestjs/samples/agent-client/dist/main.js --scenario smoke
```

Bugünkü demo token kısayoluyla:

```sh
SKMCP_AUTH=token SKMCP_USER=alice node sdks/nestjs/samples/agent-client/dist/main.js --scenario validation-retry
```

Gerçek bir backend'e (elinizde zaten geçerli bir access token varsa) karşı:

```sh
SKMCP_AUTH=bearer SKMCP_TOKEN=eyJ... SKMCP_BASE_URL=https://example.internal \
  node sdks/nestjs/samples/agent-client/dist/main.js --scenario error-envelope --tool create_order --arguments '{"item":"","quantity":0}'
```
