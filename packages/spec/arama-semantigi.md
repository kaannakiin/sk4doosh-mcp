# Arama Semantiği

> Statü: **normatif** — iki bağımsız implementasyonla doğrulandı (ASP.NET `ToolIndex` + TS `search.ts`; kompakt kart `card/` korpusuyla, üç meta-tool iki çerçevede de tel biçimi aynı).

Search-first keşfin üç meta-tool'unu ve `search_tools`'un sıralama kurallarını tanımlar. Makine-okur karşılığı: [schemas/fixture.schema.json](schemas/fixture.schema.json) `search` fixture türü; korpus [conformance/search/](../conformance/search/).

## Neden search-first

`tools/list` yalnız üç meta-tool döner. Yüzlerce endpoint agent context'ine asla topluca girmez; agent arar, bulduğunun şemasını yükler, sonra çağırır. Liste neredeyse hiç değişmediği için client cache sorunu yoktur; değişken olan arama sonuçlarıdır ve onlar her seferinde tazedir ([docs/00-genel-bakis.md](../../docs/00-genel-bakis.md)).

## Meta-tool sözleşmesi

| Tool           | Girdi                                                           | Çıktı                                                                 |
| -------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `search_tools` | `query: string` (boş olabilir), `limit: int` (1-50, default 20) | `{ total, results: Card[] }`                                          |
| `load_tool`    | `name: string`                                                  | `{ name, description, inputSchema, annotations }`                     |
| `invoke_tool`  | `name: string`, `arguments: object`                             | `InvokeSuccess` ya da `CallToolResult.isError = true` + `MappedError` |

- `search_tools`'ta boş sorgu **liste** demektir: tüm tool'lar ada göre ordinal sıralı, `limit`'e kadar. Ayrı bir `list` tool'u yoktur.
- `load_tool` çıktısında `auth` **yoktur** — [gorunurluk.md](gorunurluk.md) değişmez 3: policy adları agent'a sızmaz. `load_tool` görünürlük filtresine tabidir: gizli tool için cevap var olmayan tool'un cevabıyla aynıdır.
- `search_tools` ve `load_tool` çıktılarında `authUncertain: true`, kararın `unknown` olduğunu söyler; `total` deklaratif katmanın görünür saydığı tool sayısıdır (aşağıya bkz).
- `invoke_tool` görünürlük filtresine bakmaz ([gorunurluk.md](gorunurluk.md) değişmez 1); yaptırım gerçek pipeline'dadır. Sonuç zarfı ve hata kodları (backend'in HTTP hataları, SDK-taraflı `unknown_tool`/`not_invocable` ve [arguman-eslemesi.md](arguman-eslemesi.md)'nin argüman kodları) [hata-eslemesi.md](hata-eslemesi.md)'de normatiftir.
- Meta-tool'ların kendi açıklamaları İngilizcedir; SDK'nın dilidir, backend'in değil.

## Kompakt kart

```json
{
  "name": "get_order",
  "description": "Bir siparişi id ile getirir.",
  "parameters": "id: integer (required)"
}
```

- `description`: tool açıklaması; 160 karakteri aşıyorsa son boşlukta kesilir ve `…` eklenir. Kesme noktası bütçenin yarısından öndeyse kelime sınırı beklenmez.
- `parameters`: `inputSchema.properties`'ten `ad: tip` biçiminde, `required` listesindekilere ` (required)` eklenir; `type` yoksa (ya da tip birleşiminin null olmayan üyesi yoksa) `any`. Virgül + boşlukla birleşir. Tam şema `load_tool`'dadır.
- Özet sırası: **tamsayı-benzeri property adları önce, sayısal artan; sonra kalanlar bildirim
  sırasıyla.** Sıra kuralı normatiftir ve ECMAScript'in nesne anahtar sıralamasıyla aynıdır — JS'te
  bir nesne kurulduğunda tamsayı-benzeri anahtarlar zaten başa alınır ve bildirim sırası geri
  getirilemez, dolayısıyla kuralın kendisi bu sıra olmak zorundadır. Makine-okur karşılığı:
  [schemas/fixture.schema.json](schemas/fixture.schema.json) `card` fixture türü.

## Tokenizasyon

Sorgu ve belge aynı işlemden geçer:

1. Harf veya rakam olmayan her karakter ayırıcıdır (Unicode; Türkçe harfler kelimenin parçasıdır).
2. Kelime içi büyük harf sınırı ayırıcıdır — [isimlendirme.md](isimlendirme.md)'nin snake_case kuralıyla aynı: önceki karakter küçük harfse, veya önceki büyük **ve** sonraki küçükse. `GetPortalPresence` → `get`, `portal`, `presence`; `getQRDetails` → `get`, `qr`, `details`.
3. Token **katlanır**: NFD ayrıştırması → birleştirici işaretlerin (`\p{Mn}`) atılması → küçük harfe çevrim → NFC birleştirme. Bu sırayla, ve token bir bütün olarak (karakter karakter değil).
4. 2 karakterden kısa token atılır.
5. 3 karakterden uzun ve `s` ile biten token'ın son `s`'i düşer (`orders` → `order`, `notes` → `note`). Başka gövdeleme yoktur.

### Katlamanın gerekçesi ve sınırı

Kural 3'ün "tümü küçük harfe çevrilir" hâli hangi küçültme algoritmasının kullanılacağını söylemiyordu ve iki implementasyon sessizce ayrışıyordu: JS `toLowerCase` tam eşleme yapıp `İ`'yi `i` + U+0307'ye açıyor, .NET `char.ToLowerInvariant` basit eşleme yapıp `i` üretiyordu. `İSTANBUL` açıklaması TS'te `istanbul` sorgusuyla eşleşmiyor, C#'ta eşleşiyordu — ikisi de eski kurala uygundu.

NFD önce uygulandığında `İ` zaten `I` + U+0307'ye ayrışır, birleştirici işaret atılır ve geriye iki tarafın da aynı şekilde küçülttüğü `I` kalır. Aksanlar da aynı adımda düşer (`sipariş` → `siparis`), bu ekli dillerde önek eşleşmesini güçlendirir.

Katlama **dil-bağımsızdır**; Türkçe'ye özel eşleme tablosu yoktur. Bunun bilinçli sınırı: noktasız `ı` ile `i` ayrı harfler olarak kalır ve `ß` `ss`'e açılmaz — .NET'in invariant büyük harf tablosu bu iki karakteri çevirmediği için, katlamayı oraya genişletmek iki SDK'yı ayrıştırırdı. Sınır `dotless-i-stays-distinct.json` fixture'ıyla sabitlenir.

## Eşleşme: önek

Sorgu token'ı **en az 3 karakterse**, bir belge token'ının öneki olduğunda eşleşir; belgedeki `tf`, önek-eşleşen tüm belge token'larının frekans toplamıdır ve `df`, en az bir önek eşleşmesi taşıyan belge sayısıdır. Daha kısa sorgu token'ları yalnız tam eşleşir (`id` → `identity` ile eşleşmez).

Gerekçe: ekli diller. Türkçe açıklamalarda `siparişi`, `siparişe`, `siparişler` aynı kavramdır; gövdeleme dil bilgisi ister, önek eşleşmesi istemez. İngilizcede de `order` → `ordering`, `orders` doğal olarak kapsanır. Tersi kapsanmaz: sorgu belge token'ından uzunsa (`siparişleri` vs `siparişi`) eşleşme yoktur — sorguyu kısa tutmak agent'ın işidir ve meta-tool açıklaması bunu söyler.

## Alanlar ve ağırlıklar

| Alan          | Ağırlık |
| ------------- | ------- |
| `name`        | 3.0     |
| `description` | 1.5     |
| `tags`        | 1.0     |
| `route`       | 1.0     |

Bir belgenin terim frekansı, terimin geçtiği her alanın ağırlığının toplamıdır (`tf`). Belge uzunluğu tüm `tf`'lerin toplamıdır; ortalama uzunluk belgeler üzerinden alınır.

## Skorlama

BM25, `k1 = 1.2`, `b = 0.75`:

```text
idf(t)     = ln(1 + (N − df(t) + 0.5) / (df(t) + 0.5))
norm(t, d) = tf · (k1 + 1) / (tf + k1 · (1 − b + b · len(d) / avgLen))
score(q,d) = Σ_{t ∈ q} idf(t) · norm(t, d)
```

`N` belge sayısı, `df(t)` terimi içeren belge sayısı. Skoru sıfır olan belge sonuçta yer almaz. Sıralama: skor azalan, eşitlikte ad ordinal artan. `limit`'e kadar döner.

Ağır bağımlılık yoktur; formül her dilde on satırdır ve fixture'larla birebir eşlenebilir olması için sabitlenmiştir. Sinonim, dil modeli veya gömme kullanılmaz — bunlar SDK'nın değil, agent'ın işidir.

## Bilinen sınırlar

- Gövdeleme yalnız İngilizce çoğul `s`'dir; ekler önek eşleşmesiyle karşılanır, sözlük veya dil modeli yoktur. Açıklama dili backend'in dilidir; ağır gövdeleme SDK'ya dil bağımlılığı sokar.
- `total` **deklaratif katmanın** görünür saydığı tool sayısıdır; T2 probe onu değiştirmez ([gorunurluk.md](gorunurluk.md) T2 "Bütçe"). Probe yalnız sıralama sonrası ilk K adaya koştuğu için probe-duyarlı bir `total` `limit`'e bağımlı ve yanıltıcı olurdu.
