# `outputSchema` — Ajanın Ne Alacağını Bilmesi

**Durum:** sevk edildi — uygulama bu kaydı takip eder
**Tarih:** 17 Eylül 2026
**Kapsam:** `packages/http/spec`, `packages/http/core`, `packages/http/conformance`, `sdks/dotnet`, `sdks/nestjs`, `apps/docs` — HTTP katalog ürün hattı
**Kaynak tartışma:** [fastmcp-karsilastirma.md](fastmcp-karsilastirma.md) §4.1

---

## 1. Karar

`ToolDefinition` isteğe bağlı bir `outputSchema` alanı kazandı ve `load_tool` bunu yayınlıyor.
Değer `EndpointDescriptor.responses`'tan türetiliyor; descriptor alanı zaten vardı ve
[schema-conversion-rules.md](../../packages/http/spec/schema-conversion-rules.md) Tablo 4 onu `readOnly`
üyeler korunarak yazmayı çoktan zorunlu kılıyordu. Eksik olan tek şey türetme kuralı ve yüzeydi.

Neden: ajan bugün tool'un **ne göndereceğini** biliyordu, **ne alacağını** bilmiyordu. Çok adımlı
plan bundan kör kalıyor — "önce order'ı çek, `customerId`'sini al, sonra müşteriyi çek" zinciri
ancak birinci çağrının cevabı görüldükten sonra kurulabiliyordu. Lowin'in "atomik çağrı zincirleri"
eleştirisinin bize düşen payı buydu.

## 2. Dokuz kural

Kurallar iki SDK'da aynı ve fixture ile sabitli. Normatif metin
[metadata-contract.md](../../packages/http/spec/metadata-contract.md) `## Producing outputSchema`
bölümünde.

1. **Birincil response:** `200`, `201`, `202`, `204` bu sırayla; hiçbiri yoksa kalan 2xx'lerin
   sayısal olarak en küçüğü. Sıranın normatif olması şart — iki SDK bir endpoint'ten bir şema
   yayınlamak zorunda.
2. Seçilen response `schema` taşımıyorsa `outputSchema` yazılmaz (204 boş gövde).
3. Hiç 2xx yoksa `outputSchema` yazılmaz.
4. **Kök object değilse sarılır:** `{"type":"object","properties":{"result":S},"required":["result"]}`.
   MCP kökün object olmasını şart koşuyor. Object sayılan: `type` tam olarak `"object"`, ya da tip
   dizisinin `"null"` dışındaki tek üyesi `"object"`. `$ref` kökü, `anyOf` kökü ve tipsiz kök
   sarılır.
5. **Sarmada `$defs` köke kalkar.** `#/$defs/X` doküman köküne göre çözülür; `properties.result`
   içinde bırakılan bir çanta her referansı bağlantısız bırakır. Mevcut `liftDefs` / `LiftDefs`
   yeniden kullanıldı, şema önce klonlanıyor — descriptor katalog boyunca paylaşılıyor.
6. **`$id` taşıyan kök kaldırılmaz.** Kendi şema kaynağı, referanslarını kendi `$id`'sine göre
   çözüyor. `liftDefs`'in mevcut atlama kuralı; `bodyRootOf`'un `$id` kökü düzleştirmeyi
   reddetmesiyle aynı gerekçe.
7. **`additionalProperties` yazılmaz.** `inputSchema`'da çağıranın ne gönderebileceğini bağlıyor;
   response backend'in kendi şekli ve kısıtlanan taraf ajan değil.
8. **Küratörlük `outputSchema`'ya dokunmaz.** Response alanı argüman değil, invoke zamanında da
   yeniden adlandırılmıyor; bir operasyonun bütün `variants`'ı aynı `outputSchema`'yı yayınlıyor.
   [arguman-kuratorlugu-karari.md](arguman-kuratorlugu-karari.md)'nin "şema daraltma yok" sınırıyla
   tutarlı.
9. **Yokken anahtar hiç yazılmaz** — `undefined`/`null` değil. Mevcut 35 `metadata-extraction`
   fixture'ı bu sayede bayt bayt aynı kaldı.

## 3. Nest asimetrisi — ölçülmüş

.NET `responses`'ı zaten dolduruyordu (`EndpointCatalog.cs`, ApiExplorer'ın
`SupportedResponseTypes`'ı, `ResponseSchemaOf` ile `DropReadOnlyProperties = false`). Nest hiç
doldurmuyordu ve **doldurabilecek bir kaynağı yoktu**.

`@nestjs/common/constants.js`'in 30 metadata anahtarının hiçbiri dönüş tipi taşımıyor. TypeScript
`emitDecoratorMetadata` dönüş tipini generic'i silerek yazıyor. Ölçüm:

| Handler imzası                        | `design:returntype` |
| ------------------------------------- | ------------------- |
| `sync(): OrderDto`                    | `OrderDto` ✅       |
| `async promised(): Promise<OrderDto>` | `Promise` ❌        |
| `list(): OrderDto[]`                  | `Array` ❌          |
| `union(): OrderDto \| null`           | `Object` ❌         |
| `anyish(): any` / `unknown`           | `Object` ❌         |
| tip beyanı yok / `void`               | `undefined` ❌      |

Gerçek bir controller'da handler'ların çoğu `async`. `@nestjs/swagger`'ın bu işi çözmek için bir
derleme zamanı transformer'ı (`@nestjs/swagger/plugin`) yayınlaması aynı sınırın bağımsız kanıtı.

Bu asimetri bir tasarım tercihi değil, iki platformun farkı. Express ve Fastify'ın konuyla ilgisi
yok: onlar HTTP sunucusu, hiçbir tip bilgisi taşımazlar. ApiExplorer bir ASP.NET **MVC** katmanı,
web sunucusu özelliği değil.

### Üç katmanlı merdiven

Nest tarafında `responses` üç kaynaktan, bu sırayla:

1. `@McpTool({ responses })` — birinci sınıf beyan. Status başına: DTO class'ı, `[Class]`
   (koleksiyon), `{ schema }` (verbatim), `{}` (gövdesiz).
2. `Reflect.getMetadata("swagger/apiResponse", handler)` — `@ApiOkResponse({ type })` yazmış
   backend'ler bedava kazanır. Metadata string anahtarla okunuyor, `@nestjs/swagger` bağımlılık
   olmuyor — `descriptionOf`'un `swagger/apiOperation` için zaten yaptığı şey.
3. `design:returntype` — yalnız `Promise`, `Array`, `Object`, `Function` ve `undefined` dışındaysa.
   Yukarıdaki tablonun ilk satırı; sync handler'lı backend'lerde bedava.

Aynı fallback deseni `descriptionOf` ile birebir, yani SDK'da yeni bir kavram doğmadı.

## 4. Ne değişti

| Katman               | Değişiklik                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Şema                 | `tool-definition.schema.json` `outputSchema` kazandı (`required`'a **eklenmedi**). `additionalProperties: false` olduğu için bu edit olmadan hiçbir fixture alanı taşıyamazdı                                     |
| Üretilmiş tip        | `ToolDefinition.outputSchema?: JsonSchemaObject` ve `JsonObject? OutputSchema`. Elle yazılmadı; `pnpm gen` üretti                                                                                                 |
| `packages/http/core` | `buildOutputSchema` + `primaryResponseOf` + `isObjectRoot`, `createToolDefinition` içinde koşullu spread. `liftDefs` ve `typeOf` yeniden kullanıldı, yeni yardımcı yazılmadı                                      |
| `sdks/dotnet`        | `ToolDefinitionFactory`'de TS ikizi; `SkMcpMetaTools` `load_tool` payload'ı `OutputSchema` kazandı. Katalog tarafına **hiç dokunulmadı** — `Responses` zaten doluydu                                              |
| `sdks/nestjs`        | `McpToolOptions.responses` + `McpResponseDeclaration`; discovery'de `responsesOf` ve üç katman; `shapeOf` ikinci bir `SchemaSimplificationOptions` parametresi aldı; `load_tool` payload'ı `outputSchema` kazandı |
| Fixture              | 3 mevcut fixture `expected`'ına `outputSchema` aldı (zaten `responses` taşıyorlardı), 5 yeni vaka eklendi. 202 → **207**                                                                                          |
| Spec                 | `metadata-contract.md` (yeni `## Producing outputSchema` bölümü + tabloya satır), `search-semantics.md` (meta-tool kontratı), `schema-conversion-rules.md` (Tablo 4 response paragrafına ileri referans)          |
| Docs                 | Yeni how-to `09-tell-the-agent-what-a-tool-returns.md`, meta-tool contract ve configuration reference sayfaları, iki SDK README'sine `3c` bölümü                                                                  |
| Demo                 | İki demo da `get_order` için response tipi bildiriyor — `[ProducesResponseType]` ve `@McpTool({ responses })`. Parite iddiasının canlı ölçümü                                                                     |

### Nest'te tanı çift raporlanması

.NET'in `ResponseSchemaOf`'u, bir DTO hem request body hem response ise şema tanısının iki kez
raporlanmasını `reportedBefore` ile engelliyordu. TS tarafında karşılığı yoktu; `describe` artık
raporladıklarını bir `Set`'te tutuyor ve response geçişi zaten söylenmiş olanı tekrar etmiyor.

## 5. Bilinçli kapsam dışı

- **`structuredContent` doğrulaması.** `invoke_tool` sabit bir meta-tool; şeması çağrıdan çağrıya
  değişiyor, yani istemci onu statik şemayla doğrulayamaz. `InvokeSuccess` değişmedi. `outputSchema`
  backend'in **beyanı**, bir Swagger dokümanının statüsünde.
- **Kart `returns` satırı.** Kart bütçesi büyük sonuç kümelerini okunur tutan şey; şema bir tur
  ötede. §4.5'in `detail` knob'u gelirse soru kendiliğinden kapanıyor. `card` fixture'ları,
  `createCard` ve `CardFor` hiç dokunulmadı.
- **MCP SDK'nın kendi `Tool.OutputSchema`'sı.** Meta-tool'ların kendi çıktısı için, bizim
  yayınladığımız endpoint şeması için değil. Hâlâ yazılmıyor.
- **§4.2** (invoke payload bütçesi + timeout). §6'nın 1. adımında `outputSchema` ile birlikteydi;
  ayrı sevkiyat olarak bırakıldı — farklı şema, farklı fixture kind'ı, yeni hata kodu.

## 6. Doğrulama

| Süit / kontrol                  | Sonuç                                                   |
| ------------------------------- | ------------------------------------------------------- |
| `pnpm validate`                 | 207/207                                                 |
| `pnpm check-types`              | temiz                                                   |
| `pnpm lint` (prettier dahil)    | 21/21 görev, 0 uyarı                                    |
| `dotnet build` (net8.0+net10.0) | 0 uyarı, 0 hata                                         |
| Nest `descriptor-round-trip`    | 27 geçti, 17 atlandı (gerekçeli "unproducible"), 0 hata |
| Core ↔ fixture karşılaştırması  | 33/33 eşleşti                                           |
| İki demo, canlı MCP             | `get_order` için `outputSchema` bayt bayt aynı          |

Round-trip'in kapsadığı şey önemli: `@McpTool({ responses })` beyanından descriptor'a, oradan
`toolOf` ile `outputSchema`'ya kadar uçtan uca, 5 yeni fixture ve `ping`/`me` dahil. Yani Nest'in
üç katmanlı merdiveni sadece tip kontrolüyle değil, gerçek decorator'larla sabitli.

Canlı ölçümde çıkan tek fark `required` idi ve SDK farkı değildi: iki demo DTO'su farklı şey beyan
ediyordu (C# kaydında `[Required]` yoktu, Nest DTO'sunda `@IsInt()` zorunlu demekti). Demo hizalandı.

**Koşulmayan:** `@sk-mcp/core`, `@sk-mcp/sdk-nestjs` ve `@sk-mcp/sdk-dotnet` süitlerinin tamamı.
Round-trip dosyası dışındaki testler bu sevkiyatta çalıştırılmadı.
