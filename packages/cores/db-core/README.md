# @sk-mcp/db-core

Salt-okunur, dialect-agnostik, veritabanı okuyan MCP sunucularının paylaşılan makinesi. `@sk-mcp/mssql-mcp` bunun üzerine kurulur; `pg-mcp` de kurulacaktır.

`@sk-mcp/mcp-core`'u tüketir (tool tip makinesi, yanıt bütçesi, hata zarfı, stdio sunucusu) ve üstüne ilişkisel katmanı ekler: bağlantı havuzu, iptal kuralı, değer politikası, katalog introspection'ı ve dört tool.

Bu paket **`@sk-mcp/core` değildir** — o, spec'in HTTP katalog referans implementasyonudur.

## Ne veriyor

| Modül              | İçerik                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `model/sql`        | `SqlText` ve `QuotedIdentifier` markaları, `QuerySpec`, `QueryResult`                               |
| `model/value`      | `ColumnKind`, `ColumnDescriptor`, `NativeColumn`, `ValuePolicy`                                     |
| `model/catalog`    | `TableRef`, `TableEntry`, `KeyEntry`, `ServerFacts`, `IntrospectionScope`                           |
| `model/connection` | `ConnectionSecret`, `ConnectionProfile`, `DriverAdapter`, `DriverConnection`, `Lease`, `PoolLimits` |
| `model/dialect`    | `Dialect<TConfig>` — bir motorun diğerinden farklı bildiği her şey                                  |
| `values/encode`    | `encodeValue`, `encodeRow` — bir hücreden JSON skalerine tek politika                               |
| `pool`             | `createConnectionPool` (kuşak, kira, karantina), `runCancellable`                                   |
| `query`            | `createQueryRunner` — kirala, çalıştır, hatayı sınıflandır, bırak                                   |
| `catalog`          | `introspect`, `introspectOne` — bir introspection sorusunu çalıştır ve projelendir                  |
| `tools`            | `describe_connection`, `list_tables`, `describe_table`, `run_query`                                 |
| `source`           | `createDbSource` — dialect, profil ve sürücüyü tek nesnede bağlar                                   |
| `server`           | `createDbMcpServer` — havuzu boşaltan `close()` dahil                                               |

## Bağlayıcı kurallar

- **Bu paket asla SQL metni üretmez ve hiçbir motor adı taşımaz.** İlişkisel model isimleri — catalog, schema, table, view, column, row, query, parameter, pool, connection — ANSI sözlüğüdür ve serbesttir. `src/` içinde `TOP`, `OFFSET`/`FETCH`, `LIMIT`, `sys.`, `information_schema`, `nvarchar`, `mssql`, `tedious`, `pg` geçmesi bir defekttir.
- **Hiçbir sürücü adlandırılmaz** — ne dependency ne peer. Sürücü `DriverAdapter` ile, motor bilgisi `Dialect` ile enjekte edilir. Lint bunu paket genelinde zorlar.
- **`SqlText` yalnızca `sqlText()` ile üretilir ve o fonksiyon dialect katmanına aittir.** Agent metni `SqlText`'e yalnızca `Dialect.readOnlyGuard`'ın `allow` kolundan dönüşür; bu, "statement'ı çalıştırmadan önce guard'ı çalıştır" kuralını gelenek değil tip kuralı yapar. Tüketici paketler `importNames` ile `sqlText`'i kendi tool katmanlarından yasaklar.
- **Salt-okunurluk üç katmanlıdır ve guard en zayıfı.** Gerçek güvence veritabanı principal'ıdır; `readOnlyGuard` yalnızca bir yazma denemesinin sürücü izin hatası yerine okunaklı bir hata dönmesini sağlar. Tool açıklamaları ve `describe_connection` bunu böyle söyler.
- **İptal edilen bir istek sonlanmadan bağlantı havuza dönmez.** `runCancellable` `settled` sonlanana kadar kirayı tutar; `cancelSettleMs` aşılırsa bağlantıyı karantinaya alır. `Promise.race([run(), abort()])` bu fonksiyonun var olma sebebi olan hatadır.
- **`bigint` string olur; `decimal` onarılmaz, bildirilir.** Ölçüldü ([db-surucu-spike.md](../../../docs/db-surucu-spike.md)): geniş tamsayılar sürücüden string gelip korunuyor, ama geniş `decimal` binary64 olarak geliyor ve alt basamaklar çoktan gitmiş oluyor. Bozulmuş bir sayıyı string'e çevirmek onu hassas görünen bir forma sokar, o yüzden kayıp kolonda `precisionRisk` ile bildirilir.
- **Sırlar iki katmanda redakte edilir**: `createDbSource` çekirdeğin desenleriyle dialect'inkileri birleştirip `mcp-core`'un `ErrorContext.redact` dikişine bağlar, ve ürün normalizer'ı hataları zaten redakte doğurur.
