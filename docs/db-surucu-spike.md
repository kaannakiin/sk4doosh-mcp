# MSSQL sürücü spike'ı — ölçümler

**Durum:** koşuldu
**Tarih:** 22 Eylül 2026
**Kapsam:** `packages/cores/db-core` tasarım varsayımlarının doğrulanması. Bulgular `packages/servers/mssql-mcp`'ye uygulandı ve `test/live.spec.ts` ile aynı sunucuya karşı uçtan uca doğrulandı (10/10).
**Ortam:** SQL Server 15.0.2000.5 (2019, Developer Edition), `mssql@11.0.2` → `tedious@18.6.2`, Node 24, macOS arm64. Bir iç ağ test veritabanı; bağlantı bilgileri repoda hiçbir yerde tutulmuyor.

Bu belge [mcp-cekirdegi-karari.md](mcp-cekirdegi-karari.md)'nin eki. Plan dört maddeyi "doğrulanmamış varsayım" olarak işaretlemişti; hepsi burada cevaplanıyor.

## 1. İptal — varsayım doğrulandı, `cancelSettleMs` nadir yol

`request.cancel()` çağrıldığında promise **reject ediyor** ve hata ayırt edilebilir:

```text
name: "RequestError"   code: "ECANCEL"   message: "Canceled."
```

Ölçüm: 20 saniyelik `waitfor delay` 700 ms'de iptal edildi, promise **714 ms**'de sonlandı — yani attention onayı ~14 ms sürdü. Hemen ardından **aynı havuzdan bir sorgu sorunsuz çalıştı**.

Sonuç: `tedious` attention onayını kendi içinde bekliyor ve bağlantıyı yeniden kullanılabilir bırakıyor. `runCancellable`'ın `cancelSettleMs` kolu **nadir bir geri düşüş**, normal yol değil. Karantina mekanizması olduğu gibi kalıyor — ucuz sigorta.

## 2. `request.timeout` çalışmadı — deadline'ı kendimiz kurmalıyız

`request.timeout = 800` atanmış bir istek, 10 saniyelik `waitfor delay`'i **kesmedi**; sorgu sonuna kadar çalıştı. (`config.requestTimeout` 60 sn idi.)

Sonuç: sorgu süre sınırı sürücünün `timeout` alanına bırakılamaz. Deadline `AbortSignal` + açık `cancel()` ile kurulur — ki `runCancellable` zaten tam olarak bunu yapıyor. `mssql-mcp` bir `setTimeout` kurup signal'i abort edecek; `request.timeout`'a güvenmeyecek.

## 3. Akış — gerçek backpressure var

`request.stream = true` üzerinde `pause()` ve `resume()` ikisi de fonksiyon. Payload bütçesinin 200 bin satırı materyalize etmeden n. satırda durabilmesi mümkün.

## 4. Kolon metadata şekli — `dialect.classify`'ın girdisi

`recordset` olayı kolon adından nesneye bir kayıt veriyor:

```text
{ index, type: { name }, length, scale, precision, nullable, identity, readOnly }
```

`type.name` tedious tip adı. Ölçülen değerler:

| `type.name`        | ek alanlar            |
| ------------------ | --------------------- |
| `Int`              | length 4              |
| `BigInt`           | length 8              |
| `Decimal`          | precision 18, scale 4 |
| `Float`            | length 8              |
| `Money`            | length 8              |
| `Bit`              | length 1              |
| `NVarChar`         | length 100 (bayt)     |
| `VarChar`          | length 50             |
| `VarBinary`        | length 8              |
| `UniqueIdentifier` | length 16             |
| `DateTimeOffset`   | scale 7               |
| `DateTime`         | —                     |
| `Date`             | —                     |
| `Time`             | scale 7               |
| `Xml`              | —                     |

`type.id` tanımsız geliyor; eşleme `type.name` üzerinden yapılacak.

## 5. JavaScript değer tipleri — bir tasarım değişikliği gerektirdi

| SQL tipi           | JS'e ne geliyor | not                                             |
| ------------------ | --------------- | ----------------------------------------------- |
| `bigint`           | `String`        | `9223372036854775807` tam korunuyor             |
| `decimal(38,4)`    | `Number`        | **hassasiyet sürücüde kaybolmuş**               |
| `money`            | `Number`        | `money` = `decimal(19,4)`, aynı risk            |
| `uniqueidentifier` | `String`        | büyük harfli                                    |
| `datetimeoffset`   | `Date`          | **offset kayboluyor**, yalnızca UTC anı kalıyor |
| `varbinary`        | `Buffer`        | `Uint8Array` alt sınıfı, `encodeValue` işliyor  |
| `xml`              | `String`        | —                                               |

**Kritik bulgu:** `123456789012345678.1234` sürücüden `123456789012345680` olarak geliyor. `encodeValue`'nun ilk hali `decimal`'i string'e çeviriyordu — yani **yanlış bir sayıyı hassas görünen bir string'e** çeviriyordu. Korumasızlıktan kötü.

Düzeltildi: `decimal` artık olduğu gibi (`Number`) geçiyor, ve risk **kolon seviyesinde** `precisionRisk: true` ile bildiriliyor (`hasPrecisionRisk`, eşik binary64'ün 15 anlamlı basamağı). Gerçek çözüm — SQL tarafında string'e cast — yalnızca bizim ürettiğimiz introspection sorguları için mümkün; keyfi `run_query` metnine uygulanamaz, o yüzden F1 durumu gizlemek yerine bildiriyor.

`datetimeoffset`'in offset kaybı da aynı sınıfta ve F1'de bildirilmiyor — ayrı bir karar.

## 6. Hata taksonomisi

| durum                 | `name`         | `code`     | `number` |
| --------------------- | -------------- | ---------- | -------- |
| iptal                 | `RequestError` | `ECANCEL`  | —        |
| olmayan nesne         | `RequestError` | `EREQUEST` | 208      |
| tanınmayan ilk sözcük | `RequestError` | `EREQUEST` | 2812     |
| sıfıra bölme          | `RequestError` | `EREQUEST` | 8134     |

`selct 1` sözdizimi hatası değil **2812 "Could not find stored procedure"** veriyor — SQL Server tanımadığı ilk sözcüğü prosedür çağrısı sayıyor. `mapDriverError` bunu hesaba katmalı: 2812 kullanıcı hatasıdır, `invalid_argument`'a eşlenir.

Eşleme anahtarı: `code === "EREQUEST"` ise `number`, değilse `code` (`ECANCEL`, `ELOGIN`, `ESOCKET`, `ETIMEOUT`).

## 7. Havuz — bir mi iki mi

`mssql.ConnectionPool` gerçekten bir havuz (`size`, `available`, `borrowed`, `pending` alanları çalışıyor). `db-core`'un havuzunun altına konursa iki havuz olur.

Karar: `DriverAdapter.open()` her mantıksal bağlantı için **`max: 1` olan ayrı bir `mssql.ConnectionPool`** kuracak. `db-core`'un havuzu N tanesini yönetir, her biri tam bir fiziksel bağlantıdır, ve `request.cancel()`'ın ölçülen davranışı bağlantı başına doğru kalır. `tedious.Connection`'ı doğrudan sürmek tek havuz verirdi ama belirgin şekilde daha çok adapter kodu ister ve ölçülen iptal yolunu yeniden kurmayı gerektirirdi.

## 8. Test veritabanının principal'ı salt-okunur değil

Ölçüm:

```text
sysadmin 0 | db_datareader 1 | db_datawriter 1 | db_owner 1 | VIEW ANY DEFINITION 0
```

`create table dbo.__spike_probe (a int)` **başarılı oldu** (spike tabloyu hemen düşürdü).

Bu bir kod bulgusu değil, ortam bulgusu — ama tasarımın en önemli varsayımını o ortamda geçersiz kılıyor: salt-okunurluğun gerçek güvencesi principal'dır, `readOnlyGuard` yalnızca okunaklı hata mesajıdır. Bu kullanıcıyla `readOnlyGuard` **tek** korumadır ve bir guard atlatması gerçek bir yazma olur. `mssql-mcp` bir üretim bağlantısında `db_datareader`-only bir principal ile kullanılmalıdır; `describe_connection` durumu dürüst raporlar.

`VIEW ANY DEFINITION` 0 olması `db_owner` olduğu için kendi veritabanının kataloğunu görmeye engel değil, ama başka bir veritabanına bakamaz — tek profil modeliyle uyumlu.

## 9. `ApplicationIntent=ReadOnly` doğrulaması

Planın düzeltmesi yerinde duruyor: bu instance bir Availability Group üyesi değil (`EngineEdition 3`, Developer, standalone), ve MSSQL'in `default_transaction_read_only` karşılığı yok. `dialect.sessionSetup()` MSSQL için `[]` döner, `sessionIntent()` `"none"` döner.
