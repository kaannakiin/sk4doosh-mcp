# T-SQL tip tablosu — normatif liste ile karşılaştırma

**Durum:** uygulandı
**Tarih:** 22 Eylül 2026
**Kapsam:** `packages/servers/mssql-mcp/src/dialect/types.ts`'teki `kinds` tablosu ve `describeType`'ın kayıp verdikleri.
**Normatif kaynak:** [Data types (Transact-SQL)](https://learn.microsoft.com/en-us/sql/t-sql/data-types/data-types-transact-sql?view=sql-server-ver17) ve [money and smallmoney](https://learn.microsoft.com/en-us/sql/t-sql/data-types/money-and-smallmoney-transact-sql?view=sql-server-ver17).
**Ölçüm ortamı:** SQL Server 15.0.2000.5 (2019), `mssql@11.0.2` → `tedious@18.6.2`.

[db-surucu-spike.md](db-surucu-spike.md)'nin eki. Spike tabloyu **tek bir canlı veritabanında rastlanan** tiplerden kurmuştu; bu belge onu normatif listeyle karşılaştırıp aradaki farkı kapatıyor.

## Neden ayrı bir belge

Bir tip tablosunun eksikliği sessizdir: eşlenmemiş bir ad `unknown`'a düşer, hata vermez, ve kolon adı doğru göründüğü için kimse bakmaz. Tablonun kaynağı bu yüzden bir ölçüm değil normatif liste olmak zorunda, ve listenin taranmış olduğunun kaydı bu belge.

## İki isim uzayı

Aynı kolonu iki sözlük adlandırıyor ve `describeType` ikisine de cevap vermek zorunda:

| yol              | ad nereden gelir                 | örnek                                  |
| ---------------- | -------------------------------- | -------------------------------------- |
| `describe_table` | `sys.types.name`                 | `nvarchar`, `hierarchyid`, `geography` |
| `run_query`      | sürücünün result-set metadata'sı | `NVarChar`, `UDT`, `Geography`         |

Sürücü adları tedious'un 38 adlık kümesinden gelir — orada `Geography` **yok**. `mssql` sarmalayıcısı bir UDT kolonunu TDS'in `udtInfo.typeName`'iyle yeniden adlandırıyor (`mssql/lib/tedious/request.js`), bu yüzden `geography`/`geometry` kendi adlarıyla, `hierarchyid` ve her CLR tipi ise `UDT` olarak görünüyor.

## Normatif liste ve karşılığımız

| T-SQL ailesi              | tipler                                      | `ColumnKind`                          |
| ------------------------- | ------------------------------------------- | ------------------------------------- |
| Exact numerics            | `bit`                                       | `boolean`                             |
|                           | `tinyint`, `smallint`, `int`                | `integer`                             |
|                           | `bigint`                                    | `bigint`                              |
|                           | `decimal`, `numeric`, `money`, `smallmoney` | `decimal`                             |
| Approximate numerics      | `float`, `real`                             | `float`                               |
| Character strings         | `char`, `varchar`, `text`                   | `text`                                |
| Unicode character strings | `nchar`, `nvarchar`, `ntext`                | `text`                                |
| Binary strings            | `binary`, `varbinary`, `image`              | `binary`                              |
| Date and time             | `date`                                      | `date`                                |
|                           | `time`                                      | `time`                                |
|                           | `datetime`, `datetime2`, `smalldatetime`    | `timestamp`                           |
|                           | `datetimeoffset`                            | `timestamptz`                         |
| Other                     | `uniqueidentifier`                          | `uuid`                                |
|                           | `xml`                                       | `xml`                                 |
|                           | `json`                                      | `json`                                |
|                           | `rowversion` / `timestamp`                  | `binary`                              |
|                           | `hierarchyid`                               | `binary`                              |
|                           | `geography`, `geometry`                     | `unknown` + `lossy: "representation"` |
|                           | `sql_variant`                               | `unknown`                             |
|                           | `vector`                                    | `unknown`                             |
|                           | `cursor`, `table`                           | kapsam dışı — kolon tipi olamazlar    |

Sistem takma adı `sysname` (= `nvarchar(128)`) da `text` olarak tabloda; katalog sorgusu onu bu adla döndürüyor.

## Dört karar

### `timestamp` bir tarih değil

T-SQL'de `timestamp`, `rowversion`'ın eşanlamlısıdır: 8 baytlık bir satır sürüm damgası, zamanla ilgisi yok. `timestamp` kindine eşlemek agent'a karşılaştıramayacağı ve sıralayamayacağı bir tarih verirdi. İkisi de `binary`.

### `hierarchyid` gerçekten boş gelebilir

Ölçüm:

```text
hierarchyid::GetRoot()        UDT   Buffer <>        (0 bayt)
hierarchyid::Parse('/1/3/')   UDT   Buffer <5bc0>    (2 bayt)
```

Kök düğüm **sıfır uzunlukludur**; boş base64 bir kayıp değil, değerin kendisi. `binary` eşlemesi ve base64 kodlaması sadık.

`UDT` adı hierarchyid'e özel değil, her CLR tipini de kapsıyor — hepsi Buffer olarak geliyor, o yüzden `binary` doğru cevap. Katalog yolunda bir CLR tipinin adı kendi adıdır (`sys.types.name`), tabloda yoktur ve `unknown`'a düşer; bu kabul edilen tek asimetri.

### Spatial tipler: değer değil, sürücünün izdüşümü

`mssql` WKB'yi kendi nesnesine çözüyor (`mssql/lib/udt.js`):

```text
geography::Point(41, 29, 4326)
  → {"srid":4326,"version":1,"points":[{"x":41,"y":29,...}],"figures":[...],"shapes":[...]}
```

`encodeValue` bunu `JSON.stringify` ile metne çeviriyor. İki sorun: nesne sürücüye özgü bir şekil, standart bir gösterim değil; ve çok noktalı bir şekil `maxTextChars`'ta kesilerek **geçersiz JSON**'a dönüşüyor.

`kind` bu yüzden `unknown` kalıyor — nesne değerin kendisi değil — ve kolon `lossy: "representation"` ile işaretleniyor. Agent'ın çıkış yolu sorguda `.STAsText()`: WKT metni normal bir `text` kolonu olarak sadık geçer.

### `sql_variant` ve `vector` bilerek `unknown`

`sql_variant` kolonunun her satırı farklı tip taşıyabilir, yani kolon seviyesinde doğru olan bir `kind` yok. Değer bozulmadan geliyor (`cast(42 as int)` → `Number 42`), kayıp yok, sadece sınıflandırılamıyor.

`vector` SQL Server 2025 tipi; elimizdeki 2019 motorunda yok ve `tedious@18`'in nasıl aktardığı ölçülmedi. Ölçülmemiş bir şeye kayıp bayrağı takmak da bir iddia olurdu, o yüzden yalnızca `unknown`.

İkisi de `kinds` tablosuna **yazılmadı** — varsayılan zaten `unknown`, bir satır eklemek çalışmayan kod olurdu. Kararın kaydı bu belge ve `dialect.spec.ts`'teki "leaves the two genuinely unclassifiable types unknown and unflagged" testi.

## `money` sabitleri normatif olarak doğrulandı

| tip          | aralık                    | anlamlı basamak |
| ------------ | ------------------------- | --------------- |
| `money`      | ±922.337.203.685.477,5807 | 19              |
| `smallmoney` | ±214.748,3647             | 10              |

`fixed` tablosundaki `money → (19, 4)` ve `smallmoney → (10, 4)` doğru. binary64'ün 15 basamaklık eşiğiyle birlikte bu `money`'yi `lossy: "precision"`, `smallmoney`'yi bayraksız yapıyor — ikisi de canlı doğrulandı.

## Üç kayıp türü

`LossKind` bu çalışmayla üçe çıktı:

| değer            | ne demek                                   | hangi tipler                                |
| ---------------- | ------------------------------------------ | ------------------------------------------- |
| `precision`      | sayı sürücüde binary64'e sığmadı           | `decimal`/`numeric` precision > 15, `money` |
| `timezone`       | zaman dilimi sürücüde düştü                | `datetimeoffset`                            |
| `representation` | sürücü değeri değil kendi izdüşümünü verdi | `geography`, `geometry`                     |

Üçünde de `kind` gerçek tipini söylemeye devam ediyor; bayrak yanındaki değerin `kind`'ın vaat ettiği kadar sadık olmadığını söylüyor.
