# Katalog listesi eksikken tam görünüyordu — düzeltme kaydı

**Durum:** düzeltildi
**Tarih:** 22 Eylül 2026
**Kapsam:** `packages/cores/db-core` (`catalog/introspect.ts`, `tools/handlers.ts`, `limits.ts`), `packages/servers/mssql-mcp/src/dialect/introspect.ts`, `packages/cores/db-core/test/fake.ts`
**Bulan:** dış kod incelemesi. Üç örneğinden birini adlandırdı; kalan ikisi bu kayıtta.

## Belirti

614 okunabilir tablo ve view taşıyan bir veritabanında:

```text
maxResults=5    returned=5    complete=true   truncated=false
maxResults=50   returned=50   complete=true   truncated=false
maxResults=200  returned=200  complete=true   truncated=false
```

Agent'a "bu bağlantıda 5 tablo varmış" deniyordu. Eksik liste, tam liste olarak.

## Zincir

| adım           | kod                                                           | ne oluyordu                                    |
| -------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| SQL            | `select top (@maxResults)` **ve** `maxRows: scope.maxResults` | sunucu tam olarak istenen kadar satır yolluyor |
| sürücü         | `more: stop === "maxRows"`                                    | (N+1). satır hiç gelmediği için `more: false`  |
| `introspect()` | `result.rows.map(...)` döndürüyordu                           | `more` **bu sınırda ölüyordu**                 |
| handler        | `found.length > maxResults`                                   | N > N — **hiçbir zaman doğru olamaz**          |

İki kap da aynı sayı olduğu için yalnızca `more`'u taşımak yetmezdi; okumanın sayfadan bir fazla olması gerekiyordu.

`run_query` aynı kavramı bir fonksiyon ötede **doğru** yapıyordu (`refused || result.more`), çünkü oraya `TOP` enjekte edilmiyor ve sürücü gerçekten (N+1). satırı görüyor. Yani bu bir tasarım tercihi değil, tek yerde kaçırılmış bir sözleşmeydi.

## Kök neden: sahte gerçekten daha izin vericiydi

`test/fake.ts`'teki sürücü `spec.maxRows`'u yok sayıp scriptlenmiş satırların hepsini döndürüyordu, ve fake dialect `scope`'u hiç kullanmıyordu. Bu yüzden `marks the page truncated when maxResults cuts it` testi **geçiyordu** — üretimin tersini kanıtlayarak.

Yanlış testten kötü olan tek şey budur: ters yönde güven verir. Düzeltme sırası bu yüzden önce fake oldu; gerçekçi hale getirilir getirilmez iki test kırmızıya düştü ve ikisi de gerçek kusurdu.

İkincisi bağımsız bir bulguydu: payload bütçesi testi 5 000 satır scriptliyordu ama `defaultRows` 100, yani bütçeye hiç ulaşmıyordu. Yalnızca fake `maxRows`'u yok saydığı için "geçiyordu". Test artık `maxRows` tavanı kadar ve `maxTextChars` uzunluğunda satır istiyor.

## İncelemenin adlandırmadığı iki örnek daha

`createIntrospection(timeoutMs, maxListResults)` — **200** — `columns()` ve `keys()` sorgularına da aynı kapağı veriyordu.

- **Kolonlar.** `maxColumns` limiti 512, sürücü kapağı 200. 300 kolonlu bir tablo 200 kolonla dönerdi, `columns.length > maxColumns` reddi **asla tetiklenmezdi**, ve `describe_table` yanıtında kesilmeyi söyleyecek bir alan yoktu.
- **Anahtarlar.** Aynı kapak. Düşen bir foreign key, agent'ın hatasız biçimde **yanlış join** yazması demek.

İkisi de test veritabanında tetiklenmiyordu (en geniş tablo 80 kolon), yani gizliydi.

## Düzeltme

1. `introspect()` artık `Introspected<T> = { rows, more }` döndürüyor. Bilginin öldüğü sınır kapatıldı.
2. `list_tables` sayfadan **bir fazla** okuyor (`maxResults + 1`), `maxResults`'a kesiyor, ve fazladan satırın varlığı "devamı var" sinyali.
3. Her introspection sorusu **kendi** kapağını taşıyor: kolonlar `maxColumns + 1`, anahtarlar `maxKeys + 1`. Sürücü kapağı semantik kapaktan büyük olduğu için mevcut ret gerçekten tetikleniyor.
4. `maxKeys: 256` `dbCoreLimits`'e eklendi.
5. Kolon listesi kesikse **reddediliyor** (tablo bütün tarif edilemez); anahtar listesi kesikse `keysComplete: false` + `truncationReason: "maxKeys"` ile **bildiriliyor** (tarif hâlâ kullanışlı, ama eksiklik söylenmek zorunda).
6. Fake sürücü `spec.maxRows`'da kesiyor ve `more` üretiyor; fake dialect `scope.maxResults`'u uyguluyor.

## Doğrulama

Aynı veritabanı, düzeltmeden sonra:

```text
maxResults=5    returned=5    complete=false  truncated=true   reason=maxResults
maxResults=50   returned=50   complete=false  truncated=true   reason=maxResults
maxResults=200  returned=200  complete=false  truncated=true   reason=maxResults

dar filtre (VPOS%)  returned=52  complete=true  truncated=false
```

Son satır kontrol vakası: 52 nesnenin tamamı 200 kapağının altında kaldığı için `complete: true` — bayrak her zaman `true` dönmeye başlamış değil, gerçekten ayırt ediyor.

`db-core` 67 test, `mssql-mcp` 58 test (10'u canlı) yeşil.

## Kapsam dışı bırakılan

**Cursor / sayfa 2.** İnceleme `nextCursor` önerdi ve gerekçesi doğru — cursor son **gönderilen** nesneden devam etmeli, son okunandan değil, çünkü byte bütçesi 200 yerine 120'de kesebilir. Katalog sorgusunun `order by s.name, o.name`'i deterministik olduğu için keyset cursor burada meşru (planın "cursor yok" kararı `run_query` için doğruydu, katalogu onunla aynı kefeye koymuştu).

Bu faza alınmadı: acil olan, eksik listenin **kendini eksik ilan etmesiydi**. Sayfalama `list_tables`'ın yerini alacak `search_catalog` ile birlikte tasarlanacak, yoksa iki kez yazılır.
