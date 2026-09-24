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
| `catalog`          | `introspect` — bir introspection sorusunu çalıştır; `createCatalogCache` — katalog anlık görüntüsü  |
| `search`           | `tokenize`, `buildIndex`, `rank`, `likeMatches`, katalog cursor'u                                   |
| `tools`            | `describe_connection`, `search_catalog`, `describe_table`, `run_query`                              |
| `source`           | `createDbSource` — dialect, profil ve sürücüyü tek nesnede bağlar                                   |
| `server`           | `createDbMcpServer` — havuzu boşaltan `close()` dahil                                               |

## Bağlayıcı kurallar

- **Bu paket asla SQL metni üretmez ve hiçbir motor adı taşımaz.** İlişkisel model isimleri — catalog, schema, table, view, column, row, query, parameter, pool, connection — ANSI sözlüğüdür ve serbesttir. `src/` içinde `TOP`, `OFFSET`/`FETCH`, `LIMIT`, `sys.`, `information_schema`, `nvarchar`, `mssql`, `tedious`, `pg` geçmesi bir defekttir.
- **Hiçbir sürücü adlandırılmaz** — ne dependency ne peer. Sürücü `DriverAdapter` ile, motor bilgisi `Dialect` ile enjekte edilir. Lint bunu paket genelinde zorlar.
- **`SqlText` yalnızca `sqlText()` ile üretilir ve o fonksiyon dialect katmanına aittir.** Agent metni `SqlText`'e yalnızca `Dialect.readOnlyGuard`'ın `allow` kolundan dönüşür; bu, "statement'ı çalıştırmadan önce guard'ı çalıştır" kuralını gelenek değil tip kuralı yapar. Tüketici paketler `importNames` ile `sqlText`'i kendi tool katmanlarından yasaklar.
- **Salt-okunurluk üç katmanlıdır ve guard en zayıfı.** Gerçek güvence veritabanı principal'ıdır; `readOnlyGuard` yalnızca bir yazma denemesinin sürücü izin hatası yerine okunaklı bir hata dönmesini sağlar. Tool açıklamaları ve `describe_connection` bunu böyle söyler.
- **İptal edilen bir istek sonlanmadan bağlantı havuza dönmez.** `runCancellable` `settled` sonlanana kadar kirayı tutar; `cancelSettleMs` aşılırsa bağlantıyı karantinaya alır. `Promise.race([run(), abort()])` bu fonksiyonun var olma sebebi olan hatadır.
- **`bigint` string olur; `decimal` onarılmaz, bildirilir.** Ölçüldü: geniş tamsayılar sürücüden string gelip korunuyor, ama geniş `decimal` binary64 olarak geliyor ve alt basamaklar çoktan gitmiş oluyor (`123456789012345678.1234` → `123456789012345680`). Bozulmuş bir sayıyı string'e çevirmek onu hassas görünen bir forma sokar, o yüzden kayıp kolonda `lossy` ile bildirilir. `LossKind` üç değer taşır — `precision`, `timezone`, `representation` — ve üçünde de `kind` gerçek tipi söylemeye devam eder; bayrak yalnızca yanındaki değerin `kind`'ın vaat ettiği kadar sadık olmadığını söyler.
- **İndeks katalog sırasının bir ön ekini kapsar ve içindeki her nesne eksiksizdir.** Kolon okuması kesildiyse son nesne kolonlarıyla birlikte tamamen düşer — yarım indekslenmiş bir tablo, bir kolon aramasına sessizlikle cevap verirken başka sonuçlarda görünmeye devam eder, ve bu "o kolon yok" diye okunur. Kısmilik her yanıtta `catalog.complete` ile ilan edilir, yalnızca kurulumda değil.
- **Sıralama IDF'dir, BM25 değil.** 1–4 token'lık tanımlayıcılarda terim frekansı ayırt etmiyor, IDF ediyor; açıklamalar da terim başına bir kez sayıldığı için `k1`/`b` hiçbir alanda gerekmiyor.
- **Sırlar iki katmanda redakte edilir**: `createDbSource` çekirdeğin desenleriyle dialect'inkileri birleştirip `mcp-core`'un `ErrorContext.redact` dikişine bağlar, ve ürün normalizer'ı hataları zaten redakte doğurur.

## Catalogue search

`search_catalog` reads the catalogue once, in two queries (objects, then columns), and turns it into an inverted index held in memory for `catalogIndexTtlMs`. An empty query is the paged listing, which is why there is no `list_tables`.

Measured on a 614-object, 11 518-column SQL Server catalogue, through the live MCP envelope:

|                                    |                                            |
| ---------------------------------- | ------------------------------------------ |
| first call, index build included   | 489 ms                                     |
| second call, from the cached index | 1 ms                                       |
| index                              | 2 156 terms, 25 068 postings, about 301 KB |

On the same catalogue with the column cap lowered to 4 000, the index held 211 whole objects and 3 993 columns; the boundary object kept all 17 of its columns, and a query for a name past the boundary returned no results with `complete: false` and a hint naming where coverage ends.

The `MS_Description` path was checked against a temporary table, because the sample catalogue carried no descriptions and a join returning zero rows cannot tell "correct, no data" from "broken". The deciding row was a column **without** a description coming back `null`: a predicate missing `minor_id` or with the wrong `class` would have spread the table's description onto every column.

Deliberately out of scope:

- **Column-level result rows.** On an 11 500-column catalogue one term would produce hundreds of column results that bury the tables, and ranking would compare two different units. Column matches already appear in `matched[]`.
- **A synonym or multilingual dictionary.** A separate problem; it can be added later without changing the index surface.
- **Row counts and statistics.** A different permission surface.
- **A persistent index.** Process lifetime is enough; persistence brings an invalidation problem.
- **Suffix and substring matching.** It would close the `tarih`/`FATURATARIH` gap, at a cost not yet measured.
- **Length decay for descriptions.** Added only if long descriptions are measured to suppress ranking.
