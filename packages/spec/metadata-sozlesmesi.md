# Metadata Sözleşmesi

> Statü: **hipotez v0** — iki bağımsız doğrulaması (iki backend / iki framework) olmayan kural normatif değildir.

İki modeli tanımlar: SDK'nın framework'ünden çıkarmak zorunda olduğu **nötr endpoint modeli** (`EndpointDescriptor`) ve ondan üretilen **tool tanımı** (`ToolDefinition`). Makine-okur şemalar: [schemas/endpoint-descriptor.schema.json](schemas/endpoint-descriptor.schema.json), [schemas/tool-definition.schema.json](schemas/tool-definition.schema.json) — tek kaynak onlardır, bu döküman anlatır.

## Nötr endpoint modeli (EndpointDescriptor)

OpenAPI'nin küçük, katı bir alt kümesi. Yeni ontoloji değil; bilinen kelime dağarcığının daraltılmış hali. Alanlar:

| Alan          | Zorunlu | Anlam                                                                                      |
| ------------- | ------- | ------------------------------------------------------------------------------------------ |
| `operationId` | hayır   | Framework'ün stabil operasyon kimliği (C#: action adı / `[EndpointName]`; Nest: metod adı) |
| `method`      | evet    | `GET/HEAD/POST/PUT/PATCH/DELETE`                                                           |
| `route`       | evet    | `/` ile başlayan route şablonu; path parametreleri süslü parantezli                        |
| `description` | hayır   | İnsan-yazımı açıklama (C#: XML doc / `[Description]`; Nest: Swagger decorator'ları)        |
| `parameters`  | hayır   | `{name, in: path\|query\|header, required, schema, description?}`                          |
| `requestBody` | hayır   | `{schema, description?}`                                                                   |
| `responses`   | hayır   | Status kodu → `{schema?, description?}`                                                    |
| `auth`        | evet    | Aşağıda                                                                                    |
| `tags`        | hayır   | Gruplama (C#: controller adı; Nest: controller / `@ApiTags`)                               |

Dil kuralı: alan adları ve tool adları İngilizce; `description` içerikleri serbest (backend'in dili).

## Auth temsili (v0)

```json
{ "anonymous": false, "policies": ["OrdersRead"], "imperative": false }
```

Üç alan, üç ayrı soru. Bu temsil bir yetki modeli tanımlamaz; backend'in kendi kararlarının **okunabilir kısmını** taşır.

- `anonymous` — endpoint kimliksiz erişilebilir mi. `true` ise `policies` boş olmalıdır. Yalnız **kimlik** hakkındadır: anonim bir endpoint'te lisans/feature gibi başka bir kapı durabilir, onu `imperative` taşır.
- `policies` — yalnızca **ad** taşır, içerik taşımaz. Görünürlük filtresi adları backend'in kendi değerlendiricisine verir ([gorunurluk.md](gorunurluk.md)); içeriği bilmek gerekmez. Birleşim semantiği AND: framework'ün hiyerarşisinden (global + container + endpoint) düzleştirilen etkin küme buraya yazılır. Buraya yalnız **değerlendirilebilir** adlar girer.
- `imperative` — endpoint'te verdict'i kod olan yetki mantığı var mı. `true` ise deklaratif değerlendirme o endpoint hakkında kesin `allow` üretemez. İmperatif mantık `policies`'e ad **yazmaz**; yalnız bu bayrağı kaldırır — böylece "bu ad değerlendirilebilir mi" sorusu hiç doğmaz.

`anonymous: false` + boş `policies` + `imperative: false` = "kimlik yeter, policy yok" (çıplak `[Authorize]`).

`anonymous` framework'ün **gerçek** kuralıyla belirlenir: açık anonim işareti varsa, **veya** hiç deklaratif yetki verisi yok ve fallback policy tanımlı değilse endpoint anonimdir. Anonim endpoint'te `policies` boştur — anonim işareti deklaratif yetkiyi framework'te de kısa devre eder.

Rol gereksinimleri `policies`'e `roles:<ad>[,<ad>]` biçiminde girer (C#: `[Authorize(Roles = "a, b")]` → `roles:a,b`; Nest: roles decorator'ı). Bunlar deklaratif ve değerlendirilebilirdir; görünürlük tarafı öneki tanır ([gorunurluk.md](gorunurluk.md)).

Kaynak eşlemesi: C#'ta `policies` framework'ün deklaratif yetki verisinden, `imperative` deklaratif olmayan yetki filtrelerinin/requirement'larının varlığından gelir; Nest'te guard'lar tanım gereği imperatiftir, deklaratif metadata (roles decorator'ları vb.) varsa `policies`'e düşer.

İki alanın da boş kaldığı durum meşrudur ve tanımlıdır: auth'u tamamen custom middleware'de yaşayan backend'lerde statik olarak okunacak bir şey yoktur. Böyle bir endpoint görünürlük tarafında `unknown` olur — kayıp veri sessizce `allow`'a çevrilmez ([gorunurluk.md](gorunurluk.md) kural 4).

## Tool tanımı (ToolDefinition)

| Alan          | Kaynak                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | [isimlendirme.md](isimlendirme.md)                                                                                                                            |
| `description` | `EndpointDescriptor.description`; yoksa fallback: `"{METHOD} {route}"` (ör. `"GET /ping"`)                                                                    |
| `inputSchema` | Parametreler + requestBody'den üretilen JSON Schema (`type: object`; her parametre bir property, `required` listesi parametrelerin `required` bayraklarından) |
| `annotations` | Aşağıdaki tablodan                                                                                                                                            |
| `auth`        | `EndpointDescriptor.auth` aynen. İç modeldir: görünürlük filtresi tüketir, MCP yüzeyine çıkmaz ([gorunurluk.md](gorunurluk.md) değişmez 3)                    |

## `inputSchema` üretimi

- Kök her zaman `type: object`'tir ve `properties` ile `required` alanlarını **boş olsalar bile** yazar. Deterministik karşılaştırma için: eksik alan ile boş alan aynı şey sayılmaz.
- Her parametre bir property'dir; property şeması parametrenin `schema`'sıdır.
- Parametrenin `description`'ı property şemasına yalnız **şema kendi `description`'ını taşımıyorsa** eklenir. Şema kaynağı önceliklidir; parametre açıklaması yedektir.
- `requestBody.schema.properties` üst seviyeye düzleşir ([karar 002](../../docs/kararlar/002-arguman-eslemesi.md)); `requestBody.schema.required` girdileri `required` listesine eklenir.
- `required` sırası: önce parametreler bildirim sırasıyla, sonra body property'leri bildirim sırasıyla. Sıra normatiftir — fixture karşılaştırması dizi sırasına duyarlıdır.
- Body property adları backend'in **wire** adlarıdır, sınıf üyesi adları değil: şemadaki ad, backend'in gerçekte kabul ettiği JSON anahtarıdır. SDK bunu framework'ün serileştirme ayarından okur (C#: `JsonOptions` naming policy + `[JsonPropertyName]`); okuyamadığı kurulumda (C#: Newtonsoft) tahmin etmez — sınıf üyesi adını kullanır ve `naming_policy_unresolved` tanısı üretir, host bir çözümleyici beyan eder.

## Metod → annotation tablosu

| Metod      | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| ---------- | -------------- | ----------------- | ---------------- |
| GET / HEAD | `true`         | —                 | `true`           |
| POST       | —              | `false`           | —                |
| PUT        | —              | `true`            | `true`           |
| PATCH      | —              | `true`            | —                |
| DELETE     | —              | `true`            | `true`           |

`—` = alan yazılmaz. Gerekçeler: POST ekleyicidir (create), veri ezmez; PUT yerine-koymadır (destructive ama idempotent). Statik eşleme her endpoint'te doğru olamayacağından SDK'lar endpoint bazında override sunmalıdır (C#: `[McpTool(Destructive = true)]` benzeri); override edilen değer tabloyu ezer.
