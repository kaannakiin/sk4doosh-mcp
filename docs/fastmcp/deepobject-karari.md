# `deepObject` — Nesne Değerli Query Parametreleri, Dile Göre Tel Biçimi

**Durum:** sevk edildi — uygulama bu kaydı takip eder
**Tarih:** 21 Eylül 2026
**Kapsam:** `packages/http/spec`, `packages/http/conformance`, `packages/http/core`, `sdks/dotnet`, `sdks/nestjs`, `apps/docs` — HTTP katalog ürün hattı
**Kaynak tartışma:** [fastmcp-karsilastirma.md](fastmcp-karsilastirma.md) §4.9

---

## 1. Karar

Query parametresi artık nesne değerli olabilir. Descriptor `style: "deepObject"` ve opsiyonel `objectNotation` (`bracket` varsayılan, `dot`) taşır; composer üyeleri tek tek yazar. Host'un isteğine bağlı: `query.grouping` varsayılanı `flatten`, yani bugünkü davranış.

Ajanın gördüğü her şey iki SDK'da aynı. Ayrışan tek şey **son adım**: Nest `?filter[status]=x`, ASP.NET `?filter.status=x` yazar.

## 2. Neden — üç sessiz hata

Düzleştirme çoğu yerde yeter. Yetmediği üç yer, ve üçü de sessiz:

1. **Çakışma.** `filter` ve `sort` DTO'ları ikisi de `field` taşıyorsa düzleşince aynı isme çarpıyorlar. `duplicate_argument` atılıyordu ama kod iki SDK'nın severity tablosunda da **yoktu** — `warning`'e düşüyor, `failOn: endpointDropped` yakalamıyordu. (Aşama 0'da düzeltildi.)
2. **`[FromQuery(Name = "f")]`.** ApiExplorer leaf'i `Status` diye bildiriyor, binder `f.Status` okuyor. sk-mcp `?Status=` yazıyor, DTO **boş** bind oluyor, hata yok. `QueryObjectProbeTests.P4` bunu kurulu runtime'a karşı pinliyor.
3. **İç içe üye.** `unbound_query_object` ile düşüyor; ajan filtreyi hiç görmüyor.

## 3. Değişmez bölünmedi — girdi bölündü

İlk sezgi "fixture'a SDK başına `expected` koyalım"dı. Yanlış olurdu: `argument-mapping.md:5`'in **"Every SDK MUST produce identical output from the same input"** kuralını ikiye bölerdi ve "hangi durumda hangisi geçerli" sorusu ürünün ömrü boyunca her yeni özellikte tekrar sorulurdu.

Onun yerine **notation descriptor'a yazıldı**. İki SDK farklı _girdi_ üretiyor (keşif zaten meşru biçimde farklı), composer aynı girdiye aynı baytı veriyor. Fixture'lar tek `expected` taşımaya devam ediyor, korpus pinlemeye devam ediyor.

İkinci bir `style` değeri (`deepObjectDot`) reddedildi: `deepObject` OpenAPI'nin bracket'e verdiği ad, ve `argument-mapping.md:13`'ün kendi gerekçesi geçerli — "a descriptor assembled from an OpenAPI fragment must not mean something different here than it does there". `objectNotation` ek bir eksen, `deepObject`'in anlamını değiştirmiyor.

## 4. Ölçülen üç gerçek

Tasarımı kaynak okuması değil ölçüm belirledi.

**ASP.NET'te bracket hiç bind etmiyor.** `filter[status]` binder'ın prefix testini geçer → `ModelName = "filter"` olur → prefix'siz fallback **kapanır** → ama hiçbir leaf anahtarına denk gelmez. Sonuç sessizce boş DTO, gruplamamaktan beter. `dot` tercih değil, **zorunlu**.

**ASP.NET nokta biçimini zaten kabul ediyor.** Açık `Name` yoksa binder `?filter.Status=x` ve `?Status=x`'in ikisini de bağlar. Yani mevcut backend'ler için backend tarafında hiçbir şey açılmıyor.

**Express 5 default `query parser` = `'simple'`.** Stok Nest'te `?filter[status]=x` tek literal anahtar olarak geliyor. Host `app.set('query parser','extended')` demezse **fatal** `query_parser_not_extended` çıkıyor — uyarı değil, çünkü aksi hâlde tool backend'in yok saydığı bir filtre kurar ve ajan filtresiz sonucu doğru sanır. `unresolved_query_shape`'i düşürme yapan gerekçenin aynısı.

Uçtan uca ölçümde bir düzeltme çıktı: Nest'te bu **startup'ta değil, ilk meta-tool çağrısında** yüzeye çıkıyor, çünkü `ensureValid()` yalnız meta-tool'ların içinden çağrılıyor ve katalog lazy kuruluyor. .NET kataloğu eager, orada her tanı boot'ta görünüyor. Kataloğu Nest'te eager yapmak bu işin kapsamı değil — her tanıyı etkiler, yalnız bunu değil.

## 5. Gruplama anahtarı: `ParameterDescriptor`, referansla

.NET'te ApiExplorer DTO'yu sk-mcp görmeden düzleştiriyor. Geri toplamak için anahtar `ReferenceEquals(a.ParameterDescriptor, b.ParameterDescriptor)`: ApiExplorer action parametresi başına **tek** visitor kuruyor ve o tek örneği her leaf'e damgalıyor.

`ParameterDescriptor.Name` daha zayıf (bağlı controller özelliği ile action parametresi ad paylaşabilir); `ModelMetadata.ContainerType` tek başına anahtar değil (aynı DTO tipinden iki parametre tek gruba çökerdi) ama "bu leaf sahibinin **kendi** tipinin özelliği mi" ayrımını o yapıyor — iç içe nesnenin leaf'inde `ContainerType` farklı olduğu için ad ayrıştırmaya hiç gerek kalmıyor.

Bunların hiçbiri ASP.NET sözleşmesi değil, kurulu framework'ün davranışı. `QueryObjectProbeTests` dördünü de pinliyor.

## 6. Bir grup tüketildiyse tüm leaf'leri tüketilir

Sorgulanamayan ve iç içe leaf'ler top-level olarak geri sızarsa durum bugünkünden **kötü** olur: `?Range.Min=1` ile `?filter.Status=a` birlikte gittiğinde `ContainsPrefix("filter")` true olur, prefix'siz fallback kapanır, `Range.Min` hiç okunmaz.

## 7. Reddedilenler

**"Yalnız düzleştirmenin patladığı yerde grupla."** `inputSchema`'yı ilgisiz kodun bir negatif özelliğine bağlardı: bir DTO'ya path placeholder'ıyla aynı adlı alan eklemek o tool'un bütün argüman şeklini sessizce çevirirdi. İki SDK bu yüklemi aynı anda hesaplayamaz, ve fixture ile pinlenemez. Hedeflediği hata — sessiz düşme — Aşama 0'da `query_member_shadowed` tanısıyla çözüldü.

**Varsayılan açık.** Her etkilenen tool'un `inputSchema`'sını değiştirir **ve** küratörlük ad uzayını yeniden adlandırır (`curation.Of(parameter.Name)` artık var olmayan bir leaf'e çözülür → `curation_unresolved`). İkinci eksen daha güçlü gerekçe.

**İkiden fazla seviye.** OpenAPI'nin kendisi `deepObject`'in ikinci seviyesini tanımsız bırakıyor. İki notation'ın ikinci seviyesi aynı şekil değil; korpus SDK başına bir `expected` isterdi — yani §3'te reddettiğimiz şeyin ta kendisi.

**Nesne parametresinde `fill`.** İki dilde ikinci, nesne şeklinde bir tip kapısı ister. Yeniden adlandırma bedava ve destekli: grup bütün olarak adlanır.

**Çıplak `@Query()`'nin gruplanması.** Nest'in `QUERY` factory'si `data === undefined` iken handler'a tüm `req.query`'yi verir; `?filter[status]=x` DTO'ya `{filter:{status}}` olarak ulaşır ve `status` bekleyen DTO hiçbir şey alamaz. Takas değil, kusur olurdu.

## 8. Arama indeksi — mevcut bir kararla çarpışma

Gruplama üye adlarını indeksten çıkarıyordu: `status` aranabilir terim olmaktan çıkıp yalnız `filter` kalıyordu. Ama `nested-and-defs-parameters-not-indexed.json` **tam tersini** pinliyor: iç içe gövde üyeleri ve `$defs` indekslenmez.

Çelişki gerçek ve mevcut karar doğru — gövde keyfi derinlikte, üyeleri adreslenebilir filtre değil. Çözüm: projeksiyon `grouped` kümesini ayrıca alıyor, yalnız `deepObject` parametrelerinin üyeleri bir seviye indeksleniyor. Varsayılan boş küme, yani gruplama kapalıyken davranış bayt bayt aynı. `SearchTool` fixture'ı opsiyonel `groupedParameters` kazandı; iki fixture da yeşil.

## 9. `in: cookie` buraya ait değil

> **Yerine geçen (24 Eylül 2026):** [../cerez-parametre-karari.md](../cerez-parametre-karari.md). Aşağıdaki gerekçe taşıyıcıyı değerin sahibiyle karıştırıyordu; kimlik kuralı korunarak çerez parametresi birinci sınıf konum oldu.

§4.9 iki maddeyi bir arada tutuyordu. Cookie yarısı açık bir tasarım sorusu değil, **zaten kapalı**: `argument-mapping.md:11` `Cookie`'yi ismen identity carrier sayıyor — "identity is never an argument". Serileştirmeyle ilgisi yok; tersine dönmesi için görünürlük/kimlik modelinin değişmesi gerekir. §5 "Kopyalanmayacaklar"a taşındı.

## 10. Doğrulama

24 yeni `argument-mapping` fixture'ı (`object-query-` ailesi) + 1 `search` fixture'ı, toplam **291**; yeni kind açılmadı, mevcut 44 argument-mapping fixture'ı **bayt bayt aynı** kaldı.

.NET runner ham `JsonElement` okuduğu için **iki** anti-vacuity bayrağı eklendi: `grouped` ve `dotted`. Tek bayrak yetmezdi — bracket ailesi onu notation okuyucusu bozukken de tatmin ederdi.

Fixture'ın kanıtlayamadığı iki şey host testinde: `QueryObjectProbeTests` (ApiExplorer'ın ne ürettiği) ve `QueryObjectGroupingHostTests` (gruplamanın descriptor'a ne yaptığı, ve kapalıyken hiçbir şeyin değişmediği).

## 11. Uçtan uca ölçüm

Fixture iki SDK'nın bir dize üzerinde anlaştığını kanıtlar; binder'ın o dizeyi okuduğunu yalnız gerçek istek kanıtlar. İki demo da `DEMOAPI_QUERY_GROUPING=group` ile iki modda koşuldu.

**ASP.NET model binder'ı, canlı** (`GET /orders`, bağlanan DTO'yu yankılıyor):

| Tel                                          | Sonuç                                 |
| -------------------------------------------- | ------------------------------------- |
| `?Owner=alice`                               | bağlanır — prefix'siz greedy fallback |
| `?filter.Owner=alice`                        | bağlanır — prefix'li biçim            |
| `?filter[Owner]=alice`                       | **sessizce boş DTO**                  |
| `?Owner=alice` (`[FromQuery(Name="f")]` ile) | **sessizce boş DTO** — mevcut hata    |
| `?f.Owner=alice`                             | bağlanır — gruplamanın ürettiği biçim |

**Tool yolundan.** Gruplama kapalıyken `orders_search_aliased` `Owner` argümanını ilan ediyor, ajan gönderiyor, 200 dönüyor, `echoed` tamamen null. Açıkken şema `{f:{Owner,…}}` oluyor ve `echoed.owner == "alice"`. Fixture'ın göremeyeceği iki şey de doğrulandı: dizi üye `List<string>`'e **iki eleman** olarak bağlandı (virgül birleştirme olsaydı tek eleman olurdu) ve kardeş skaler `take` yutulmadı.

**Arama recall'ı.** Gruplama açıkken `search_tools "Owner"` ve `"MinQuantity"` hâlâ `orders_search` ile `orders_search_aliased`'ı buluyor — üyeler `filter`/`f` içine gömülü olmasına rağmen.

**Nest tarafında iki düzeltme çıktı.** İkisi de gruplamaya özgü değil, query string'in doğası:

- Query değerleri hep string; `@IsInt()` bir üye `@Type(() => Number)` olmadan reddediliyor. Düz modda da aynı.
- `qs` bir anahtar **bir kez** geçerse string, tekrarlarsa dizi üretiyor — `?items=a` da `?f[items]=a` da. Yani tek elemanlı dizi üye host'un `@Transform`'unu gerektiriyor; iki seviyede de aynı, gruplama bir şey değiştirmiyor. Demo DTO'su ikisini de taşıyor.

Ölçülen `qs` davranışı (6.15.3, `allowPrototypes`): `f%5Bitems%5D=a` ile `f[items]=a` **aynı** girdi — anahtar `parseKeys`'ten önce decode ediliyor, yani ham bracket tercihi doğruluk için değil okunabilirlik için. Ve `f.items=a` `extended` altında bile `{"f.items":"a"}` veriyor — Nest'te nokta hiç parse edilmiyor, bracket tek seçenek.

**Düzeltilen bir iddia.** "Fatal, startup'ta düşer" yanlıştı: Nest'te `ensureValid()` yalnız meta-tool'ların içinden çağrılıyor ve katalog lazy kuruluyor, yani `query_parser_not_extended` **ilk `search_tools` çağrısında** yüzeye çıkıyor. Fatal ve mesajı doğru, ama boot'ta değil. .NET kataloğu eager, orada her tanı startup'ta görünüyor. Nest kataloğunu eager yapmak bu işin kapsamı değil — yalnız bunu değil her tanıyı etkiler.
