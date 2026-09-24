# @sk-mcp/mssql-mcp

Microsoft SQL Server okuyan salt-okunur MCP sunucusu. `@sk-mcp/db-core` üzerine kuruludur ve ondan başka hiçbir `@sk-mcp/*` paketi adlandırmaz.

Dört tool: `describe_connection`, `search_catalog`, `describe_table`, `run_query`.

## Çalıştırma

Bağlantı süreç başlarken ortamdan girer. **Agent bağlantı bilgisi veremez** — hiçbir tool argümanı taşımaz.

```text
SKMCP_MSSQL_SERVER=10.0.0.5
SKMCP_MSSQL_DATABASE=Sales
SKMCP_MSSQL_USER=mcp_reader
SKMCP_MSSQL_PASSWORD=...
SKMCP_MSSQL_PORT=1433                       # varsayılan
SKMCP_MSSQL_ENCRYPT=true                    # varsayılan
SKMCP_MSSQL_TRUST_SERVER_CERTIFICATE=false  # varsayılan
SKMCP_MSSQL_CONNECT_TIMEOUT_MS=15000        # varsayılan
SKMCP_MSSQL_QUERY_TIMEOUT_MS=30000          # varsayılan

npx sk-mcp-mssql
```

İlk dördü zorunlu. Ayrıştırma istekli ve ölümcül; **bağlanma tembel** — ölü bir veritabanı sunucunun açılmasını ve `tools/list` cevaplamasını engellemez.

## Salt-okunurluk

Üç katman, ve **en zayıfı bu paketin içinde**:

1. **Veritabanı principal'ı — gerçek güvence.** `db_datareader` ve başka hiçbir şey olan bir kullanıcıyla bağlanın.
2. **Oturum.** MSSQL'de yok. `ApplicationIntent=ReadOnly` yalnızca bir availability group içinde okunabilir secondary'ye yönlendirir; standalone instance'ta hiçbir şey garanti etmez. `describe_connection` bunu `sessionIntent: "none"` diye dürüst raporlar.
3. **Statement guard — yalnızca okunaklı hata.** `readOnlyGuard` yorumları ve string literallerini maskeleyip ilk sözcüğün `SELECT` ya da `WITH` olmasını, tek statement olmasını ve yazma anahtar sözcüğü taşımamasını arar. **Güvenlik sınırı değildir.** Yazma yetkisi olan bir principal'la bağlanırsanız bu guard'ın atlatılması gerçek bir yazma olur.

## Bağlayıcı kurallar

- **`src` üç lint-zorunlu katman + üç kök giriş noktası.** `platform/` (db-core ve node sınırı), `dialect/` (SQL yazan **tek** klasör), `driver/` (`mssql` adını anan **tek** klasör); `cli.ts`, `server.ts`, `index.ts` kökte kalır ve tek kompozisyon köküdür.
- **`sqlText` ve `quotedIdentifier` yalnızca `dialect/` içinde çağrılabilir**, `importNames` ile yasaklanmış. Agent metni `SqlText`'e yalnızca `readOnlyGuard`'ın `allow` kolundan dönüşür.
- **`process.env` yalnızca `cli.ts`'te okunur** ve her değişken adıyla erişilir — `turbo/no-undeclared-env-vars` böylece her birini `turbo.json`'ın `passThroughEnv`'ine yazmaya zorlar.
- **Sorgu süre sınırı `request.timeout`'a bırakılmaz.** Ölçüldü: o alan çalışan bir statement'ı kesmiyor (`request.timeout = 800`, 10 sn'lik `waitfor delay`'i durdurmadı). Deadline bir zamanlayıcı + açık `cancel()`.
- **Tip tablosunun kaynağı normatif listedir, bir veritabanında rastlananlar değil.** `dialect/types.ts` T-SQL'in tam tip listesini karşılar ve iki isim uzayına birden cevap verir (`sys.types.name` ve sürücünün result-set adı). Eşlemelerin gerekçeleri ve bilerek `unknown` bırakılan iki tip `dialect/types.ts`'in guard'larında ve `test/dialect.spec.ts`'te.
- **Her mantıksal bağlantı `max: 1` olan kendi sürücü havuzudur.** Havuzlamanın sahibi `db-core`; altına ikinci bir havuz koymak iki çağrının onun arkasından aynı soketi paylaşmasına yol açardı — iptal kuralının dayandığı şeyin tam tersi.

## Test

`pnpm turbo run test --filter=@sk-mcp/mssql-mcp` — saf fonksiyon testleri, veritabanı gerekmez.

Katalog SQL'i sahteyle doğrulanamaz: snapshot metnin değişmediğini kanıtlar, join'lerin doğru olduğunu değil. `test/live.spec.ts` bunun için var ve gerçek bir sunucuya karşı koşar:

```text
SKMCP_MSSQL_LIVE=1 SKMCP_MSSQL_SERVER=... pnpm turbo run test --filter=@sk-mcp/mssql-mcp
```

`SKMCP_MSSQL_LIVE` yoksa atlanır, yani CI'nın veritabanına ihtiyacı olmaz. **Bu takımı üretime karşı koşmayın** — sorgu iptali ve bağlantı koparma deniyor.

Every driver fact this server relies on was measured on SQL Server 15.0.2000.5 (2019 Developer Edition) with `mssql@11.0.2` → `tedious@18.6.2`, which is why `mssql` is pinned exactly. `tedious` is still resolved by `mssql`'s own range, so re-run the live suite after a lockfile change that moves it.
