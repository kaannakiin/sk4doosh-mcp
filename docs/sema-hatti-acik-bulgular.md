# Şema Hattı — Açık Bulgular

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

Faz 3 planı ([plan.md](fazlar/faz-3-sema-ve-arama/plan.md)) `sema-donusum-kurallari.md` adlı normatif dosyayı ve `schema-simplification/` fixture dizinini vaat ediyordu. İkisi de repo'da yok. Dolayısıyla şu kurallar ne tanımlı ne pinlenmiş durumda ve NestJS SDK'sının uygulaması gereken bir sözleşme de mevcut değil:

- Generic wrapper soyma (`ApiResponse<T>` → `T`).
- Derinlik sınırı ve inline etme (bugün `MaxDepth` sabiti içerikleri sessizce `{"type":"object"}`'e indiriyor).
- Recursion'ın `$ref` + not ile kırılması (bugün döngü koruması yine sessiz daraltma yapıyor).
- Input şemasından server-computed/readonly alanların düşürülmesi (bugün `CreationDate`, `ModifiedByUserID` gibi denetim alanları normal girdi alanı olarak görünüyor).

## Doğrulaması tamamlanmamış bulgular

Denetimde çıkan, adversarial doğrulama turuna sokulmamış maddeler:

- Gövde alanı açıklamaları (`[Description]`, XML doc) şemaya hiç taşınmıyor.
- Üretilen şema `additionalProperties: false` yazmıyor, oysa `RequestComposer` bilinmeyen argümanı `unknown_argument` ile reddediyor — şema izin veriyormuş gibi duruyor.
- DataAnnotations kısıtları (`[Range]`, `[MinLength]`, `[MaxLength]`, `[RegularExpression]`) şemaya geçmiyor; agent sınırı ancak 400 alarak öğreniyor.
