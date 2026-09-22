# `search_tools(detail)` — Turu Ajanın Seçmesi

**Durum:** sevk edildi — uygulama bu kaydı takip eder
**Tarih:** 18 Eylül 2026
**Kapsam:** `packages/http/spec`, `packages/http/conformance`, `packages/http/core`, `sdks/dotnet`, `sdks/nestjs`, `apps/docs` — HTTP katalog ürün hattı
**Kaynak tartışma:** [fastmcp-karsilastirma.md](fastmcp-karsilastirma.md) §4.5

---

## 1. Karar

`search_tools` isteğe bağlı bir `detail: "card" | "schema"` argümanı kazandı, default `card`.
`schema` seçildiğinde `results`'ın her girdisi, o tool için `load_tool`'un döndüreceği nesnenin
**aynısı** oluyor; ajan `load_tool` turunu atlayıp doğrudan `invoke_tool`'a gidiyor.

`detail` yalnız projeksiyonu seçiyor. Sıralama, `limit`, `total` ve görünürlük filtresi
etkilenmiyor; `authUncertain` iki şekilde de görünüyor.

## 2. Neden — atlanan tur, ve default'un neden kart kaldığı

Kart kasten fakir: 160 karakterde kesilmiş açıklama, tek satır parametre özeti, `outputSchema` yok.
Gerekçesi büyük katalog: ajanın **seçmediği** tool'ların şemaları maliyetin tamamı, ve yirmi şema
bir sayfaya sığmaz. Bu gerekçe hâlâ geçerli, o yüzden default kart kalıyor — FastMCP'nin kendi
CodeMode bulgusu da büyük kataloglarda staged discovery'nin daha iyi çalıştığını söylüyor.

Ama gerekçe ajanın hangi operasyonu istediğini **bilmediği** durumu tarif ediyor. Bildiği durumda
üçüncü tur, elde edilebilecek bir şemayı öğrenmek için ödenen bir tur. Bu takasın hangi tarafında
olduğunu ajan biliyor, SDK bilmiyor. O yüzden SDK tahmin etmeyi bırakıp soruyor.

Ürün ilkesi §4.4'ünkiyle aynı: kendi mantığıyla gelen bir kullanıcının bizim öngörmediğimiz bir
akışı kurabilmesi, bizim onun yerine seçmemizden iyi.

## 3. Tek projeksiyon: `ToolDetail`, iki meta-tool

`load_tool`'un yayınladığı nesne iki SDK'da da **inline literal**di; paylaşılan tek projeksiyon
`createCard`/`CardFor` idi ve o öteki şekli üretiyordu. "Aynı nesne" iddiasını iki ayrı literal ile
taşımak, ayrışmayı zaman meselesi yapardı.

Tek projeksiyon çıkarıldı: `createDetail` / `DetailFor`. İkisini de `load_tool` ve
`search_tools(detail:"schema")` çağırıyor, ve tek korpus ikisini birden pinliyor.

TS tarafında tip üretilmiş `ToolDefinition`'dan türetiliyor, elle yazılmıyor:

```ts
export type ToolDetail = Pick<
  ToolDefinition,
  "name" | "description" | "inputSchema" | "outputSchema" | "annotations"
> & { readonly authUncertain?: boolean };
```

`Pick` `auth`'u adlandırmıyor, dolayısıyla `{ ...tool }` yazmak **tip hatası**. Politika adının
ajana sızmaması ([visibility.md](../../packages/http/spec/visibility.md) değişmez 3) böylece derleyici
tarafından korunuyor; C# tarafında üyeler tek tek adlandırılıyor ve ikisini birden
`detail/auth-is-never-emitted.json` kontrol ediyor.

## 4. C# tarafında argümanın şeması — neden enum değil, `[AllowedValues]`

Spec'in status satırı iki framework'ün aynı argüman kümesini yayınladığını iddia ediyor, o yüzden
`detail`'in yayınlanan şeması ölçülerek seçildi. Üç yol denendi, ikisi elendi:

- **Çıplak `enum SearchDetail`.** `SkMcpJson.Wire` input-şema üretimine hiç ulaşmıyor — beş çağrı
  yerinin hepsi response serialization. Üretim `McpJsonUtilities.DefaultOptions` üzerinde koşuyor ve
  orada `JsonStringEnumConverter` yok, yani `EnumConverter.GetSchema` `{"type":"integer"}` yazıyor.
  Ajanın `0` göndermesi gerekirdi.
- **`[JsonConverter(typeof(JsonStringEnumConverter<T>))]`.** Değerler PascalCase (`"Card"`,
  `"Schema"`) çıkıyor; adlandırma politikası converter örneğinden geliyor ve `SkMcpJson.Wire`'ın
  snake_case politikası burada devrede değil.
- **Her iki enum yolu için ortak ve belirleyici gerekçe:** CLR tipi enum olunca `"banana"` argüman
  bind'i sırasında `JsonException` fırlatıyor, yani `SearchTools` hiç çalışmıyor. Cevap ne clamp
  oluyor ne sk-mcp zarfı, ve `Respond`'dan hiç geçmiyor.

Seçilen: CLR tipi `string`, şema süslemesi `[AllowedValues("card", "schema")]`. Attribute yalnız
yayınlanan şemayı süslüyor, bind zamanı doğrulama yapmıyor — clamp'i ulaşılabilir kılan tam olarak
bu. `AllowedValuesAttribute` .NET 8+ ve `Microsoft.Extensions.AI.Abstractions`'ın net8.0 asset'inde
mevcut, yani her iki hedefte de canlı.

## 5. TS tarafında `.catch` — ve onsuz doğacak ayrışma

Simetrik tuzak zod'da: `z.enum(["card","schema"]).default("card")` bilinmeyen değeri **reddediyor**.
Yani `[AllowedValues]` ile eşleştirilseydi `detail: "banana"` C#'ta kart dönerken TS'te doğrulama
hatası olurdu — tek argüman üzerinde iki SDK'nın anlaşmazlığı.

`.catch("card")` ölçüldü: bilinmeyen değeri `card`'a düşürüyor **ve** yayınlanan şemayı
değiştirmiyor (`{"default":"card","type":"string","enum":["card","schema"]}`, zod 4.5.4). Kodda
guard yorumu olarak duruyor.

## 6. Tanınmayan değer karta düşer — "sessiz çözüm" yasağı neden buraya değmiyor

`schema` dışındaki her değer — yok, boş, tanınmayan, büyük/küçük harf farkı — `card`. Karşılaştırma
tam eşleşme (`Ordinal`).

Yasak [naming.md](../../packages/http/spec/naming.md)'in kuralı ve **katalog** hakkında: iki endpoint bir
adı talep ettiğinde SDK host'un beyan etmediği bir kazanan uydurur ve gerçek bir defekti
geliştiriciden gizler. `detail` çağrı başına bir ajan argümanı, beyan edilmiş bir default'u var ve
tek talep sahibi. Beyan edilmiş default'a düşmek hakemlik değil, default'un işini yapması —
`limit: 0 → 1` ve `limit: 9999 → 50` ile aynı sırada, ki docs onu zaten "reddedilmez, clamp'lenir"
diye ilan ediyor.

Ayrıca yayınlanan şema `enum`'u taşıyor: şemaya uyan istemci `"banana"` gönderemez, uymayan istemci
de yanan bir tur yerine **ucuz** cevabı alır. Reddetmek iki tarafta eşleşen bir hata zarfı elle
yazmayı gerektirirdi — yeni hata yüzeyi, yeni fixture, ajana sıfır fayda.

## 7. Bütçe: üçüncü daraltma argümanı, ikinci bir limit değil

`detail: "schema"` default `limit` ile çoğu zaman 256 KiB'ı aşacak. İki seçenek vardı.

Sevk edilen: `searchNarrowing` üçüncü bir girdi kazandı (`detail`), `limit` el değmeden kaldı. Red
zarfı artık "query'i daralt, limit'i küçült, ya da `detail: card`" diyor; ajan tek turda düzeltiyor,
yani **en kötü hâl başabaş** — özelliğin kazandırmayı vaat ettiği turun aynısı.

Reddedilen: schema modunda daha düşük bir `limit` tavanı. İki implementasyonun anlaşması ve spec'in
normatif kılması gereken uydurma bir sabit olurdu — `search-semantics.md`'nin `parameters` alanını
kırpmayı reddettiği paragrafın aynısı buraya birebir uyuyor. Üstelik `limit`'i başka bir argümanın
değerine göre iki anlama gelir hâle getirirdi: 20 isteyen ajan 20 kart ya da 5 şema alır ve saymadan
hangisi olduğunu bilemez. Spec bunu açıkça yasaklıyor: bir implementasyon `limit`'i `detail`'e göre
yeniden yorumlayamaz.

## 8. Yeni fixture kind `detail` — ve kapattığı eski açık

Onuncu kind açıldı: `packages/http/conformance/detail/`, 6 vaka, 227 → **233**.

Mevcut `card` kind'ını genişletmek reddedildi: `CardFixture.expected` `additionalProperties: false`
ve iki şekli bir disjunction yapmak, `parameters`'ı unutulmuş bir kart fixture'ının sessizce ikinci
dala uyup geçmesi demekti — `validate.mjs`'in iki yönlü kind kontrolünün önlemek için yazıldığı
hatanın tam kendisi. İki projeksiyonun anlamlı girdileri de farklı: bir detail fixture'ının
`outputSchema` taşıyan, taşımayan ve `auth`'u dolu tool'lara ihtiyacı var, kart bunların hiçbirini
görmüyor.

Karşılığında **eski bir açık kapandı:** `load_tool`'un yayınladığı şekli bugüne kadar hiçbir fixture
pinlemiyordu. Tek projeksiyon olduğu için tek korpus ikisini birden sabitliyor.

## 9. Yan kapanış: "byte-identical input schema" iddiası zaten yanlıştı

`search-semantics.md`'nin status satırı "üç meta-tool iki framework'te aynı wire form'u yayınlar"
diyordu, `apps/docs` ise "byte-identical names, descriptions and input schemas". İkisini de hiçbir
test pinlemiyordu, ve ölçüm yanlış olduklarını söylüyor: TS `$schema` anahtarını ve `z.number()
.int()`'in yazdığı sayısal sınırları yayınlıyor, .NET ikisini de yayınlamıyor, ve anahtar sırası
farklı. Docs'taki literal şema bloğu iki SDK'nın **hiçbirine** uymuyordu.

İddia daralttıldı: iki framework'ün birbirine borçlu olduğu şey argüman kümesi, tipleri, default'ları
ve her cevabın şekli. Anahtar sırası ve dialect süslemesi (`$schema`, bir tamsayının sınırları)
framework detayı. Bu artık spec'te yazılı, docs'ta düzeltilmiş, ve **ilk kez testle pinli**:
.NET'te `T16`, Nest'te karşılığı, ikisi de canlı `tools/list` üzerinden okuyor.

## 10. Bilinçli kapsam dışı

- **`load_tool` kaldırılmadı.** `detail` onu opsiyonel yapıyor ama gereksiz kılmıyor: görünürlük
  filtresine tabi olması ve gizli bir tool'a var olmayan tool ile aynı cevabı vermesi spec'in
  parçası.
- **Schema modunda ayrı `limit` tavanı yok** (§7).
- **`search` fixture kind'ı değişmedi.** O sıralamayı sabitliyor, `detail` ise projeksiyonu; `expected`
  hâlâ yalnız ad listesi.
- **Kartın `returns` satırı.** [outputschema-karari.md](outputschema-karari.md) §5 bu soruyu
  "§4.5 gelirse kendiliğinden kapanır" diye bırakmıştı. Kapandı: şemanın tamamını isteyen ajan
  `detail: "schema"` diyor, kart bütçesi olduğu gibi duruyor.

## 11. Doğrulama

| Süit / kontrol       | Sonuç                                     |
| -------------------- | ----------------------------------------- |
| `@sk-mcp/core`       | 405/405                                   |
| `@sk-mcp/sdk-nestjs` | 382 geçti, 17 atlandı (gerekçeli), 0 hata |
| `@sk-mcp/sdk-dotnet` | 186/186, net8.0 ve net10.0                |
| `pnpm validate`      | 233/233                                   |
| `pnpm check-types`   | 26/26                                     |
| `pnpm lint`          | 21/21 görev, 0 uyarı                      |
| `pnpm boundaries`    | 1739 dosya, sorun yok                     |
| `dotnet build`       | 0 uyarı, 0 hata                           |
| `pnpm build`         | 19/19                                     |

Yeni testler: `detail` korpusu üç runner'da (`conformance: detail`, `C14_DetailFixtures_AllPass`);
Nest'te `detail: "schema"` çıktısının aynı tool için `load_tool` cevabına eşitliği, tanınmayan
değerin karta düşmesi, ve yayınlanan `detail` şeması; .NET'te `T16` aynı şemayı canlı `tools/list`
üzerinden okuyor.

**Koşulmayan:** `@sk-mcp/excel-mcp`, `@sk-mcp/xml-mcp` ve `@sk-mcp/file-core` süitleri — bu
değişiklik onların bağımlılık grafiğine girmiyor.
