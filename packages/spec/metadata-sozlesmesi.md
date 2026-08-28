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
{ "anonymous": false, "policies": ["OrdersRead"] }
```

- `anonymous: true` → endpoint kimliksiz erişilebilir; `policies` boş olmalıdır.
- `policies` yalnızca **ad** taşır, içerik taşımaz. Görünürlük filtresi adları backend'in kendi değerlendiricisine verir ([docs/nasil-calisiyor.md](../../docs/nasil-calisiyor.md)); içeriği bilmek gerekmez. Birleşim semantiği AND: framework'ün hiyerarşisinden (global + controller + endpoint) düzleştirilen etkin küme buraya yazılır.
- Nest'in imperatif guard'ları için opak referans biçimi: `"guard:RolesGuard"` (Faz 6'da netleşir).
- `anonymous: false` + boş `policies` = "kimlik yeter, policy yok" (`[Authorize]`'un çıplak hali).
- **Açık soru (motokurye bulgusu):** auth'u tamamen custom middleware'de yaşayan backend'lerde policy listesi statik olarak çıkarılamaz — orada bu temsil boş kalır; görünürlük filtresinin bu senaryodaki davranışı Faz 3'te ayrıca çözülmek zorundadır.

## Tool tanımı (ToolDefinition)

| Alan          | Kaynak                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | [isimlendirme.md](isimlendirme.md)                                                                                                                            |
| `description` | `EndpointDescriptor.description`; yoksa fallback: `"{METHOD} {route}"` (ör. `"GET /ping"`)                                                                    |
| `inputSchema` | Parametreler + requestBody'den üretilen JSON Schema (`type: object`; her parametre bir property, `required` listesi parametrelerin `required` bayraklarından) |
| `annotations` | Aşağıdaki tablodan                                                                                                                                            |
| `auth`        | `EndpointDescriptor.auth` aynen                                                                                                                               |

## Metod → annotation tablosu

| Metod      | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| ---------- | -------------- | ----------------- | ---------------- |
| GET / HEAD | `true`         | —                 | `true`           |
| POST       | —              | `false`           | —                |
| PUT        | —              | `true`            | `true`           |
| PATCH      | —              | `true`            | —                |
| DELETE     | —              | `true`            | `true`           |

`—` = alan yazılmaz. Gerekçeler: POST ekleyicidir (create), veri ezmez; PUT yerine-koymadır (destructive ama idempotent). Statik eşleme her endpoint'te doğru olamayacağından SDK'lar endpoint bazında override sunmalıdır (C#: `[McpTool(Destructive = true)]` benzeri); override edilen değer tabloyu ezer.
