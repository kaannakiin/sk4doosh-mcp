# Seçim Hiyerarşisi

> Statü: **normatif** — iki bağımsız implementasyonla doğrulandı (ASP.NET `SelectionResolver` + TS `isSelected`; `[McpTool]`/`[McpIgnore]` ve `@McpTool()`/`@McpIgnore()` aynı `selection/` korpusunu geçiyor).

Hangi endpoint'lerin MCP yüzeyine açıldığını tanımlar. Makine-okur karşılığı: [schemas/fixture.schema.json](schemas/fixture.schema.json) `selection` fixture türü; korpus [conformance/selection/](../conformance/selection/).

## Üç ayrı katman, karıştırılmamalı

| Katman         | Sorusu                                          | Tanımı                         |
| -------------- | ----------------------------------------------- | ------------------------------ |
| **Seçim**      | Bu endpoint agent'a hiç açık mı?                | bu döküman                     |
| **Görünürlük** | Açık olanlardan bu çağıran hangilerini görüyor? | [gorunurluk.md](gorunurluk.md) |
| **Yaptırım**   | Çağrı geçiyor mu?                               | backend'in pipeline'ı          |

Seçim çağırandan bağımsızdır ve uygulama açılışında sabitlenir; görünürlük her aramada çağırana göre hesaplanır. Seçilmemiş endpoint hiçbir kimlik için görünmez.

## Üç seviye, en özel kazanır

| Seviye      | Kapsamı                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| `global`    | Uygulamadaki tüm endpoint'ler                                                 |
| `container` | Bir grubun tüm endpoint'leri (C#: controller sınıfı; Nest: controller sınıfı) |
| `operation` | Tek endpoint (C#: action metodu; Nest: handler metodu)                        |

Bir endpoint'in etkin kararı, **işaret taşıyan en özel seviyenin** kararıdır: `operation` > `container` > `global`. Daha genel seviyeler yalnız daha özel bir işaret yoksa devreye girer.

Bu, framework'lerin kendi metadata modelinin doğrudan sonucudur; yeni bir mekanizma icat edilmez. (C# karşılığı: endpoint metadata'sı en genelden en özele sıralı gelir, en son yazan kazanır. Nest karşılığı: `Reflector`'ın metot metadata'sını sınıf metadata'sının önüne alan çözümü.)

## İşaretler

Her seviye üç durumdan birindedir: işaret yok · `include` · `exclude`. `global` seviyesi işaretsiz olamaz, bir default taşır.

| Girdi                                      | Sonuç                                |
| ------------------------------------------ | ------------------------------------ |
| `container: include`, `operation: exclude` | dışarıda — en özel kazanır           |
| `container: exclude`, `operation: include` | içeride — istiss tek endpoint'i açar |
| `global: include`, işaret yok              | içeride                              |
| `global: exclude`, işaret yok              | dışarıda                             |

## Global default `exclude`

Beyan edilmeyen hiçbir endpoint açılmaz. Bu, [karar 001](../../docs/kararlar/001-kimlik-tasiyicilari.md)'in default-deny değişmezinin seçim hali: bir backend'e SDK eklemek, o backend'in tüm yüzeyini agent'a açmak anlamına gelmemelidir.

`global: include` meşru bir kurulumdur (tüm yüzeyi açıp istisna oymak), ama **beyan gerektirir** — default olamaz.

## Aynı seviyede çakışma hatadır

Bir seviyede hem `include` hem `exclude` işareti varsa bu bir hatadır (`ambiguous_selection`). SDK sessizce birini seçemez; açılışta/build'de açık hata verir.

Kural, daha özel bir seviye o seviyeyi zaten ezecek olsa bile geçerlidir. Gerekçe: çelişkili beyan çelişkili kaynak koddur; raporlamamak, ileride daha özel işaret kaldırıldığında davranışı sessizce değiştirir. [isimlendirme.md](isimlendirme.md)'deki `name_collision` ile aynı ilke — sessiz çözüm yasak.

## Seçim adı belirlemez

Seçim yalnız "açık mı" sorusunu cevaplar. Tool adı [isimlendirme.md](isimlendirme.md)'ye göre üretilir; ad çakışması seçimden bağımsız bir hatadır. Bir endpoint'i seçmek, adının geçerli olduğunu garanti etmez — iki kontrol de açılışta koşar.
