# Şema Hattı — Açık Bulgular

> Statü: **kapandı.** 2026-09-07 ölçümü (aşağıdaki son bölüm) beş doğrulanmış bulgunun ve
> "doğrulaması tamamlanmamış" üç maddenin tamamının kodda kapandığını gösterdi. Ölçümün açığa
> çıkardığı kalan kayıplar — derinlik sınırı, döngü, paylaşılan tipin iki kez yazılması, wrapper
> soyma, dizi/skaler gövde kökü — Faz 6'da kapatıldı
> ([karar 012](kararlar/012-tip-sekli-ve-sema-kural-katmani.md),
> [karar 013](kararlar/013-govde-koku-tel-bicimi.md)) ve çalışan kuralların tamamı artık
> `packages/conformance/schema-simplification/` korpusuyla iki implementasyonda pinli. Bu belge
> tarihsel kayıt olarak durur; güncel kural metni
> [sema-donusum-kurallari.md](../packages/spec/sema-donusum-kurallari.md).

Tarih: 2026-09-03. Kapsam: endpoint → `ToolDefinition.inputSchema` hattı. Kaynak: Faz 4 sonrası yapılan denetim; her bulgu gerçek `JsonSchemaMapper` derlenip koşturularak ya da canlı MCP oturumuyla kanıtlandı. Bu döküman yalnız **sorunu** kaydeder; çözüm ve sıralama açık bırakılmıştır.

Hat: [JsonSchemaMapper.cs](../sdks/dotnet/src/SkMcp.AspNetCore/Discovery/JsonSchemaMapper.cs) (CLR tipi → JSON Schema) → [EndpointCatalog.cs](../sdks/dotnet/src/SkMcp.AspNetCore/Discovery/EndpointCatalog.cs) (ApiExplorer → `EndpointDescriptor`) → [ToolDefinitionFactory.cs](../sdks/dotnet/src/SkMcp.AspNetCore/Tools/ToolDefinitionFactory.cs) (parametre + gövde → tek `inputSchema`). TS karşılığı: [tool-definition.ts](../packages/core/src/tool-definition.ts).

## Doğrulanmış bulgular

### 1. Sözlük alanları dizi olarak tarif ediliyor

`JsonSchemaMapper.Map` içinde koleksiyon kontrolü (`ItemType`) sözlük kontrolünden **önce** geliyor. `Dictionary<K,V>` aynı zamanda `IEnumerable<KeyValuePair<K,V>>` olduğu için her zaman koleksiyon dalına düşüyor; `IDictionary` dalı ölü kod.

Üretilen şema:

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": { "Key": { "type": "string" }, "Value": { "type": "string" } }
  }
}
```

Şemaya uyan agent `[{"Key":"a","Value":"b"}]` gönderiyor; hem System.Text.Json hem Newtonsoft bunu reddediyor (ikisi de `{"a":"b"}` bekliyor). Şemayı sağlayan hiçbir JSON değeri backend'i geçemiyor; istek tamamen 400 oluyor.

Kapsam: motokurye'de `BaseDTO` iki sözlük alanı taşıyor (`FieldColumns`, `FieldControls`) ve 360 sınıfın atası; 216 controller action `[FromBody]` kullanıyor.

### 2. Nesne olarak serileşmeyen gövdeler şemadan tamamen kayboluyor

`[FromBody] List<int>`, `[FromBody] string`, `[FromBody] Dictionary<…>`, Newtonsoft `JObject` gibi tipler `EndpointCatalog`'un gövde birleştirme adımında düşüyor ve `RequestComposer` hiç gövde göndermiyor.

`load_tool` sonucu:

```json
{ "type": "object", "properties": {}, "required": [] }
```

Tool `search_tools`'ta normal görünüyor, argümansız bir tool gibi duruyor, ama hiçbir argüman kombinasyonuyla çağrılamıyor. Ne tanı (`CatalogDiagnostic`) ne uyarı üretiliyor.

### 3. Gövde alanı ile parametre adı çakışması sessizce bozuk şema üretiyor

Route/query/header parametresi ile gövde alanı aynı ada sahipse `ToolDefinitionFactory.BuildInputSchema` gövdeden geleni üzerine yazıyor: parametrenin tipi ve açıklaması kayboluyor. [arguman-eslemesi.md](../packages/spec/arguman-eslemesi.md) bunun tool üretim anında **fail-fast hata** olmasını söylüyor; kod bunu tespit etmiyor ve bozuk tool listelenmeye devam ediyor.

### 4. Enum tel biçimi yanlış olabiliyor

`JsonSchemaMapper` enum'ları her zaman `{"type":"string","enum":[CLR adları]}` olarak yazıyor. System.Text.Json'ın kendi varsayılanı **sayısal**; `JsonStringEnumConverter` kurulu değilse şema yalan söylüyor ve agent'ın gönderdiği isim binding'de düşüyor. Repo içindeki DemoApi tam da bu kurulumda.

### 5. Gövde alanları için `required` üretilmiyor

`JsonSchemaMapper` nesne dalında hiçbir zaman `required` dizisi yazmıyor; `ToolDefinitionFactory`'nin gövde `required`'ını okuyan dalı bu yüzden ölü kod. Route/query parametreleri etkilenmiyor (`Parameter.Required` alanından geliyor), yalnız gövde alanları isteğe bağlı görünüyor.

Örnek: `AddNoteRequest.Text` alanı `[Required]` olmasına rağmen `add_order_note` şeması `"required": ["id"]` diyor. Agent bir tur ziyan ediyor; Faz 4 hata eşlemesi `validation_failed` + alan adıyla kurtardığı için tek tur maliyeti.

## Denetimde elenen iddialar

- **`byte[]` dizi olarak eşleniyor.** Kod hatası gerçek (base64 yerine tamsayı dizisi) ama DemoApi ve motokurye'de bu dala giren erişilebilir bir gövde alanı bulunamadı.
- **Yanıt şemaları agent'a hiç ulaşmıyor.** Bilinçli tasarım: [tool-definition.schema.json](../packages/spec/schemas/tool-definition.schema.json) `additionalProperties: false` ve yanıt alanı içermiyor; `metadata-extraction` fixture'ları bunu açıkça pinliyor.

## Spec boşluğu (kusur değil, yazılmamış özellik)

> 2026-09-07: `sema-donusum-kurallari.md` **yazıldı**; listedeki son madde (readonly alan düşme)
> hem orada Tablo 4 olarak normatif hem kodda uygulanmış durumda — ölçüldü. `schema-simplification/`
> fixture dizini ve kalan üç madde Faz 6'nın konusu.

Faz 3 planı ([plan.md](fazlar/faz-3-sema-ve-arama/plan.md)) `sema-donusum-kurallari.md` adlı normatif dosyayı ve `schema-simplification/` fixture dizinini vaat ediyordu. İkisi de repo'da yok. Dolayısıyla şu kurallar ne tanımlı ne pinlenmiş durumda ve NestJS SDK'sının uygulaması gereken bir sözleşme de mevcut değil:

- Generic wrapper soyma (`ApiResponse<T>` → `T`).
- Derinlik sınırı ve inline etme (bugün `MaxDepth` sabiti içerikleri sessizce `{"type":"object"}`'e indiriyor).
- Recursion'ın `$ref` + not ile kırılması (bugün döngü koruması yine sessiz daraltma yapıyor).
- Input şemasından server-computed/readonly alanların düşürülmesi (bugün `CreationDate`, `ModifiedByUserID` gibi denetim alanları normal girdi alanı olarak görünüyor).

## Doğrulaması tamamlanmamış bulgular

> 2026-09-07: bu bölümün **üç maddesi de doğrulandı ve üçü de kodda kapanmış çıktı** — ayrıntı ve
> ölçüm çıktıları aşağıdaki "Ölçüm: 2026-09-07" bölümünde. Madde metinleri tarihsel kayıt olarak
> duruyor.

Denetimde çıkan, adversarial doğrulama turuna sokulmamış maddeler:

- Gövde alanı açıklamaları (`[Description]`, XML doc) şemaya hiç taşınmıyor.
- Üretilen şema `additionalProperties: false` yazmıyor, oysa `RequestComposer` bilinmeyen argümanı `unknown_argument` ile reddediyor — şema izin veriyormuş gibi duruyor.
- DataAnnotations kısıtları (`[Range]`, `[MinLength]`, `[MaxLength]`, `[RegularExpression]`) şemaya geçmiyor; agent sınırı ancak 400 alarak öğreniyor.

## Ölçüm: 2026-09-07 (Faz 6 başlangıcı)

Kapsam: gerçek `JsonSchemaMapper` 17 DTO şekline ve enum'lar üç farklı host serileştirici ayarına
karşı koşturuldu ([SchemaBaselineDump.cs](../sdks/dotnet/tests/SkMcp.Tests/SchemaBaselineDump.cs));
ayrıca DemoApi'ye karşı canlı MCP oturumunda `load_tool` çıktısı okundu. Aşağıdaki her satır
ölçümdür, kod okuması değil.

### Kapanan bulgular

| Bulgu | Ölçüm |
| ----- | ----- |
| 1. Sözlükler dizi olarak tarif ediliyor | Kapandı. `Dictionary<string,string>` → `{"type":"object","additionalProperties":{"type":"string"}}`. `List<KeyValuePair<string,int>>` doğru şekilde **dizi** kalıyor (map ayrımı arayüz tabanlı). |
| 4. Enum tel biçimi yanlış olabiliyor | Kapandı; Tablo 3'ün dört satırı da ölçüldü. Host `JsonSerializerOptions` default → `{"type":"integer","enum":[0,1]}`; `JsonStringEnumConverter(camelCase)` → `{"type":"string","enum":["tr","de"]}`; converter'sız string → `["Tr","De"]`; `[Flags]` → yalnız `type`, `enum` **yazılmıyor**; okunamayan host → `anyOf[string, integer]`. |
| 5. Gövde alanları için `required` üretilmiyor | Kapandı. Canlı `load_tool add_order_note` → `"required":["id","text"]`; `text` gövde alanı ve `[Required]` taşıyor. Faz 4 notlarının ertelenenler listesindeki madde de böylece kapandı. |
| Gövde alanı açıklamaları şemaya taşınmıyor | Kapandı. Canlı çıktıda `text` → `"description":"Not metni"`, `item` → `"Ürün adı"`, `quantity` → `"Adet"`. |
| `additionalProperties: false` yazılmıyor | Kapandı ve **türetiliyor**. Canlı `create_order`/`add_order_note` köklerinde `"additionalProperties":false`; sözlük gövdede `true`. |
| DataAnnotations kısıtları şemaya geçmiyor | Kapandı. Canlı `create_order` → `item` `minLength:1`, `quantity` `minimum:1,maximum:100`. Harness'ta ayrıca `maxLength`, `pattern`, `format:"email"`, ve dizide `minItems` (`minLength` **değil**) doğrulandı. |
| 3. Gövde alanı / parametre çakışması | Karar 009 uyarınca `argument_collision` + endpoint düşürme olarak ele alındı. |
| Üye sırası | Ölçüldü: taban tipin üyeleri önce, sonra türetilmişin; her tip içinde bildirim sırası. |
| Salt-okunur üye düşmesi | Ölçüldü: get-only `DateTime`/`int` düşüyor; get-only koleksiyon ve sözlük kalıyor; constructor'a bağlı get-only üye kalıyor. `00-genel-bakis.md`'nin "server-computed/readonly alanlar düşürülür" vaadi **karşılanmış durumda**. |

### Açık kalan, ölçülmüş kayıplar

**Derinlik sınırı 4. seviyeyi tamamen yutuyor.** `MaxDepth = 3`. Dört seviyeli bir DTO'da üçüncü
inişten sonra:

```json
{ "type": "object", "additionalProperties": true }
```

`DeepOne.Leaf` alanı agent'a hiç görünmüyor — şekil bilgisi kaybı, çökme değil.

**Döngü aynı opak nesneye çöküyor.** `Node { Name, Node? Child }`:

```json
{"type":"object","properties":{"Name":{"type":"string"},"Child":{"type":"object","additionalProperties":true}}}
```

Karşılıklı döngüde (`MutualLeft` ↔ `MutualRight`) kesme noktasını **derinlik sınırı** belirliyor,
döngü koruması değil — `Left` üçüncü seviyede opaklaşıyor.

**Paylaşılan tip bayt bayt iki kez yazılıyor.** Aynı `Address` tipini iki üyede kullanan bir DTO'da
`Billing` ve `Shipping` şemaları tam olarak kopyalanıyor. `$defs`/`$ref` yok, dolayısıyla
`inputSchema` tip sayısıyla değil **kullanım** sayısıyla büyüyor.

**Generic sarmalayıcı hiç soyulmuyor.** `ApiResponse<Address>` → `{"Data":{…},"Succeeded":{"type":"boolean"}}`;
agent gerçek yükü bir seviye aşağıda arıyor.

**Dizi/skaler gövde kökü.** `List<int>` → `{"type":"array","items":{"type":"integer"}}`,
`string` → `{"type":"string"}`. İkisi de nesne olmadığı için `EndpointCatalog` endpoint'i
`non_object_body` ile düşürüyor (karar 009'un ara çözümü).

### Yeni bulgu: `object` tipli üye "hiçbir şey kabul etmiyor" diyor

Bu ölçümde çıktı ve daha önce kayda geçmemişti. `object` tipli bir üye skaler sözlüğünde
bulunmadığı için nesne dalına düşüyor ve **üyesi olmayan bir nesne** üretiyor:

```json
{ "Anything": { "type": "object", "properties": {} },
  "Bag":      { "type": "object", "additionalProperties": { "type": "object", "properties": {} } } }
```

`sema-donusum-kurallari.md:31`'e göre `properties: {}` *bildirilmiş boş nesne* demektir ve sınır
çıktısından (`additionalProperties: true`) ayırt edilebilir olması bilinçlidir. Sonucu:
`allowsAdditional` `false` döner, `RequestComposer`'ın izin listesi kapanır ve o alana gönderilen
her anahtar `unknown_argument` ile reddedilir. Yani `Dictionary<string, object>` ve `Hashtable`
değerleri "hiçbir şey kabul etmiyor" olarak tarif ediliyor — oysa gerçekte her şeyi kabul ediyorlar.
Doğru çıktı sınır nesnesidir; düzeltme `additionalProperties`'i `false`'tan `true`'ya çevirdiği için
izin listesini genişletir, bu yüzden kendi commit'i ve kendi testiyle inecek.

### Canlı MCP oturumu (DemoApi, `:5178`, 9 tool, 0 tanı)

```text
load_tool create_order
{"type":"object","properties":{
   "item":{"type":"string","description":"Ürün adı","minLength":1},
   "quantity":{"type":"integer","description":"Adet","minimum":1,"maximum":100}},
 "required":["item"],"additionalProperties":false}
```

`example-agent-client` üç senaryosu da geçiyor: `smoke` (alice → 200), `validation-retry`
(bilerek geçersiz argüman → `validation_failed` + alan adları → düzeltme → 200),
`error-envelope` (bob → `forbidden`/403). Bu üçlü Nest demosunun karşılaştırma tabanı.
