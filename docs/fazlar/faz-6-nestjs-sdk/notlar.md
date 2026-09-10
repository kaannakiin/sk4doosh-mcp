# Faz 6 — Notlar

Tarih: 2026-09-07. Kapsam: NestJS keşif/seçim/isimlendirme/katalog/arama/görünürlük/meta-tool'lar,
TypeShape IR ve şema kural katmanı, gövde kökü, kart kuralı, spec v1.0. Kalan: aşağıdaki
"Ertelenenler".

## Açık soruların cevapları

**Nest'te sentetik request/response üretiminin temiz yolu.** Karar 004'te çözülmüştü; bu fazda
üzerine iki şey eklendi: `markers.ts` modül-özel `Symbol`'larla sentetik istek ve probe bayrağını
taşıyor (faz-3 notlarının açık bıraktığı **M9 aynası** kapandı), ve dispatcher'a `probe()` girişi
eklendi. Adapter Express olarak sabitlendi — `httpAdapter.getInstance()`'ın çağrılabilir bir
`(req,res)` handler'ı olduğu varsayımı Fastify'da tutmaz; sınır yazıldı, Fastify çözülmedi.

**Hangi spec kuralları farkında olmadan ASP.NET aromalı kalmış?** Üç tanesi:
Nest'in var olmayan roles decorator'ı (`metadata-contract.md` + `visibility.md`, üç cümle), probe
uygunluk kuralının "MVC action" ifadesi, ve "kesme noktası olmayan endpoint" sınırının ASP.NET'e
özgü olması. Üçü de düzeltildi; tam liste [karar 014](../../kararlar/014-spec-v1-0-ve-amendment-listesi.md).

**Nest'te caller identity'nin arama öncesi değerlendirmesi: sentetik context mi, ayrı policy yolu
mu?** İkisi de değil — asıl bulgu şu: `@nestjs/common` hiçbir authorization sözleşmesi tanımlamıyor,
dolayısıyla T0/T1 yapısal olarak kör. Görünürlüğü T2 probe taşıyor ve probe bir global
`APP_INTERCEPTOR` kısa devresiyle **gerçek pipeline'dan** geçiyor. Guard'ları DI'dan çözüp
`canActivate` çağırmak reddedildi: middleware'i atladığı için `req.user`'ı middleware'de kuran
kurulumda yanlış `deny` üretir, yani değişmez 2'yi ihlal eder. Gerekçe ve reddedilen alternatifler
[karar 011](../../kararlar/011-nestjs-gorunurluk-ve-probe.md).

## Ne ölçüldü

**Şema hattı taban ölçümü** ([SchemaBaselineDump.cs](../../../sdks/dotnet/tests/SkMcp.Tests/SchemaBaselineDump.cs)):
gerçek `JsonSchemaMapper` 17 DTO şekline + 3 enum host ayarına karşı koşturuldu, canlı MCP
oturumuyla `load_tool` çıktısı okundu. Sonuç [sema-hatti-acik-bulgular.md](../../sema-hatti-acik-bulgular.md)'a
tarihli bölüm olarak işlendi. Özet: beş doğrulanmış bulgunun ve "doğrulaması tamamlanmamış" üç
maddenin **tamamı kodda kapanmış** çıktı — belgenin statü başlığı bayattı. Gerçek boşluk başkaydı:
çalışan kuralların hiçbiri fixture'lı değildi.

**Açık kalan kayıplar ölçüldü:** `MaxDepth=3` 4. seviyeyi tamamen yutuyordu (`DeepOne.Leaf` agent'a
görünmüyordu); döngü opak nesneye çöküyordu; aynı tipi iki üyede kullanan DTO şemayı **bayt bayt iki
kez** yazıyordu; `ApiResponse<T>` soyulmuyordu.

**Yeni bulgu (kayda geçmemişti):** `object` tipli üye `{"type":"object","properties":{}}` üretiyordu
— yani _bildirilmiş boş nesne_. `allowsAdditional` `false` döndüğü için `RequestComposer`'ın izin
listesi kapanıyordu: `Dictionary<string, object>` ve `Hashtable` değerleri "hiçbir şey kabul
etmiyor" olarak tarif ediliyordu, oysa her şeyi kabul ediyorlar. Düzeltme izin listesini _hiçbir
şeyden_ _her şeye_ genişlettiği için kendi testiyle sabitlendi (`J8e`).

**İki demo paritesi, dört kimlikle ölçüldü.** Aynı boş sorgu, aynı kullanıcılar:

| Kimlik | dotnet                                                                                                              | Nest                     |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| alice  | add_order_note, create_order, **get_health**, get_order, orders_get_receipt, orders_me, orders_ping, orders_summary | aynı, `get_health` hariç |
| bob    | **get_health**, orders_get_receipt, orders_me, orders_ping, orders_summary                                          | aynı, `get_health` hariç |
| carol  | **get_health**, orders_audit, orders_get_receipt, orders_me, orders_ping, orders_summary                            | aynı, `get_health` hariç |

Tek fark `get_health`: dotnet demo'sundaki minimal API endpoint'inin Nest karşılığı yok (amendment
6). Rol filtresi iki tarafta da aynı çalışıyor — `orders_audit` yalnız carol'a görünüyor.

**Nest bağlaması ölçümle düzeltildi.** İlk yazım `class-validator` metadata'sının ayırıcısını
`entry.type` sanıyordu ve bütün kısıtları sessizce düşürüyordu. Gerçek metadata dökülünce ayırıcının
`entry.name` olduğu görüldü — tüm `@IsX` dekoratörleri `type: "customValidation"` taşıyor.

**Test sayıları:** core 280, sdk-nestjs 204, dotnet 163 (net10.0). Korpus 103 → **140** fixture,
7 → **9** tür (`schema-simplification` 21, `card` 8, artı body-root ve `$defs` fixture'ları).

## Alınan kararlar

- **TypeShape IR** — [karar 012](../../kararlar/012-tip-sekli-ve-sema-kural-katmani.md). Bağlama/kural
  ayrımının sınırı taşındı; Tablo 1-7'nin 34 satırından 22'si fixture'lanabilir hale geldi (öncesi
  ~10). `JsonSchemaMapper` `TypeShapeBinder` + `SchemaWriter` olarak bölündü, façade kaldı.
- **Derinlik sınırı kaldırıldı, döngü `$defs`/`$ref` oldu.** Kullanıcı kararı: SDK çıktısının
  doğruluğunu istemcinin agent'ının varsayılan kalitesine göre aşağı çekemez. Hoisting yalnız
  paylaşılan/döngüsel tiplere uygulanır; kök her zaman satır içi kalır.
- **Sentetik `body` argümanı** — [karar 013](../../kararlar/013-govde-koku-tel-bicimi.md).
  `non_object_body` emekliye ayrıldı.
- **Nest görünürlüğü probe-taşımalı, `describeVisibility()` kaçış kapısıyla** —
  [karar 011](../../kararlar/011-nestjs-gorunurluk-ve-probe.md). `visibility.tier` default'u
  `declarative` kaldı: probe'un maliyeti sessizce açılmaz.
- **9. fixture türü `card`** (kullanıcı onayı). Kart kuralı öncesinde hiçbir fixture'la pinli
  değildi; core'a taşınınca ikinci bir TS tüketicisi oluştu.
- **Genişletme noktaları altıda kaldı**: `visibilityEvaluator` + `probeEvaluator` eklendi (karar
  006:37 önceden yetkilendirmişti), `as const satisfies` kısıtı korundu. DTO şema türetimi bir
  delegate, tabloya satır eklemedi.

## Sürprizler

**IR'ın şeklini C# üreticisi belirledi.** Bariz modelleme `oneOf`-ayrıştırmalı bir `TypeNode`
olurdu; ama `generate-types.mjs` `type !== "object"` olan `$def`'i **sessizce atlıyor** ve onu
referans veren her record var olmayan bir tipi adlandırıyor. IR bu yüzden tek düz kayıt oldu.
Aynı turda üreticiye yinelenen-başlık guard'ı eklendi ve gerçekten fırlattığı doğrulandı
(`Constraints`'i geçici olarak `Auth` yapıp denendi).

**Kart parametre sırası JS'te kurtarılamıyor.** İlk tasarım "bildirim sırasını koru" diyordu; ama
JavaScript bir nesne kurulduğunda tamsayı-benzeri anahtarları başa alır ve bildirim sırası
**kaybolur**, geri getirilemez. Kural bu yüzden ECMAScript'in kendi sıralaması olmak zorunda kaldı
ve dotnet ona uyduruldu. Kuralın kendisi normatif yazıldı.

**`InMemoryTransport` kimlik taşımıyor.** Meta-tool matrisini önce in-memory MCP transport'uyla
yazdım; `requestInfo` yalnız HTTP transport tarafından doldurulduğu için hiçbir kimlik akmadı ve
her şey 401 aldı. Test gerçek `app.listen(0)` + `StreamableHTTPClientTransport`'a çevrildi — dotnet
V21'in aynı sebeple yaptığı şey.

**`validation-retry` senaryosu ilk koşuda düştü ve spec'in kendi öngördüğü yerde düştü.**
`error-mapping.md` "Faz 6'da NestJS SDK'sının kendi metadata katmanı geldiğinde yeniden
değerlendirilir" diyordu; katalog gelince `knownFields` elde oldu ve mesajın baş token'ını kapalı
kümeye karşı eşlemek tahmin değil arama haline geldi.

**`net8.0`'da `K5_SingleFlight_ParallelSearches_ProbeOnce` yük altında flaky.** Tam suite
koşusunda bir kez düştü, yalıtımda 3/3 geçti. Benim değişikliklerimle ilgisi yok (cache ve
single-flight'a dokunulmadı); kayda geçsin diye yazıldı, düzeltilmedi.

## Kapanış turu (ilk raporda ertelenmiş olarak yazılan dört madde)

**`listChanged` + jenerasyon damgası — birlikte kapandı.** `transport.md` bildirimin dürüst olmasını
`_meta["sk-mcp/catalogGeneration"]` damgasına dayandırıyor: üç meta-tool'un listesi hiç değişmediği
için damga olmadan `tools/list` payload'u bayt-aynı kalır ve bildirim boş bir sinyale döner.
`registerSkMcpTools` artık kayıtta damgalıyor, katalog değişikliğine abone oluyor, değişimde üç
tool'u yeniden damgalayıp o oturuma **tek** bildirim atıyor. `RegisteredTool.update()` kullanılmadı:
kendi bildirimini attığı için üç tool üç bildirim üretirdi. Abonelik sunucu kapanınca bırakılıyor.

Bu maddenin ilk gerekçesi **yanlış ölçümdü** — "MCP TS SDK'sı `_meta` yüzeyi vermiyor" yazmıştım.
`@modelcontextprotocol/sdk@1.30.0`'da `registerTool` config'i `_meta` alıyor
(`mcp.d.ts:150-157`) ve `RegisteredTool.update({_meta})` var (`:311-320`). Çerçeve sınırı yoktu.
Sonucu ciddiydi: `transport.md`'nin damgası "iki implementasyonla doğrulandı" diye kaldırılmıştı, oysa
dokümanın kendi normatif iki maddesi Nest'te karşılanmıyordu. Şimdi karşılanıyor; matris N1-N6'ya
G1-G2 eklendi.

**M8 aynası kapandı.** dotnet dış isteğin `RemoteIpAddress`/`RemotePort`/`Local*`'unu sentetik
`HttpContext`'e kopyalıyor; Nest'te sentetik istek çıplak bir `Socket` üzerine kuruluyordu, yani
`req.ip` boştu. Somut etki faz-3'te motokurye'de ölçülenin aynısı: IP'ye göre partition eden bir
rate limiter tüm agent trafiğini tek kovaya atar.

Mekanizma arayışı bir çerçeve sınırı buldu: MCP TS SDK'sının `RequestInfo`'su `{headers, url?}`
(`types.d.ts:7953`), soket taşımıyor — yani tool handler'ından dış isteğe ulaşılamıyor. Çözüm
`AsyncLocalStorage`: `SkMcpStreamableHttp.handle()` her MCP isteğini dış bağlantı bilgisiyle bir
scope'a sarıyor, `outerFrom(extra)` onu `OuterRequest.connection`'a koyuyor, dispatcher sentetik
sokete yansıtıyor. Bu, dotnet'in `IHttpContextAccessor`'ının yapısal ikizi — o da altında
`AsyncLocalStorage`'ın .NET karşılığını kullanıyor, dolayısıyla simetri kurulmuş oldu, yeni bir
kavram icat edilmedi. Karar 003'ün "uydurma yok" kuralı korundu: dış bağlantı yoksa alan boş kalır,
loopback asla yazılmaz. Kanıt `G3`: `invoke_tool` ile çağrılan bir endpoint `req.ip`'i ve
`req.socket.remoteAddress`'i geri yansıtıyor, ikisi de dış istemcinin loopback adresine eşit. Reddedilen alternatif: sunucu kurulurken `@Req()`'i yakalamak — stateful
oturumda sunucu ilk istekte kurulup tekrar kullanıldığı için sonraki çağrılarda `initialize`
isteğinin soketini gösterirdi.

**Yarım B kuruldu, ve plandaki tasarımı yanlış çıktı.** Plan "her `metadata-extraction`
fixture'ının `input`'unu üreten bir host kur, üretilen descriptor'ı `input`'a deep-equal karşılaştır"
diyordu. Ölçüm bunun **hiçbir** fixture için mümkün olmadığını gösterdi: fixture'lar ASP.NET
çıktısı olarak yazılmış — `operationId`'ler PascalCase, `container` alanı hiç yok, `tags` küçük
harf, ve `responses` dolu; Nest keşfi ise `operationId` olarak handler adını, `container` olarak
sınıf adını, `tags` olarak sınıf adının gövdesini yazıyor ve `responses` hiç üretmiyor.

Bu alanların hiçbiri `createToolDefinition`'ın girdisi değil (o yalnız `parameters`,
`requestBody.schema`, `description`, `method`, `route`, `auth` okuyor); tool **adını** etkiliyorlar,
ve ad zaten `naming` korpusuyla ayrıca pinli. Bu yüzden test daha güçlü olan yönde kuruldu:
Nest keşfi → descriptor → `createToolDefinition` → **fixture'ın beklediği tool'a eşit**, artı
descriptor'ın `method`/`route`/`auth`/`parameters`/`requestBody` alanlarının fixture'ın `input`'una
eşitliği. 11 fixture'ın 7'si geçiyor; kalan 4'ün üretilemezlik gerekçeleri
[karar 014](../../kararlar/014-spec-v1-0-ve-amendment-listesi.md)'te ve testin skip listesinde
yazılı. Test ayrıca her fixture'ın ya üretildiğini ya skip listesinde olduğunu doğruluyor — yeni bir
fixture sessizce atlanamıyor.

Nest'in üç auth şeklinin tamamına (`anonymous: yes|no`, dolu `policies`, `imperative: true`)
`describeVisibility()` ile ulaşılabildiği bu turda ölçüldü; ilk raporda `get-order-policy`,
`ping-anonymous` ve `me-authenticated` "üretilemez" diye yazılmıştı, yanlıştı — ikisi üretiliyor,
`get-order-policy` ise auth yüzünden değil parametre açıklaması yüzünden üretilemiyor.

## Biçimlendirme kapısı (kapanış turunda bulunan repo tuzağı)

`pnpm turbo run gen` sonrası `packages/core/src/generated/*.ts` sürekli "değişmiş" görünüyordu.
Sebep semantik değildi: generator çıktısını Prettier'dan geçirmiyordu, `pnpm format` ise geçiriyordu
— yani `gen` ile `format` birbirinin çıktısını bozuyordu ve ne `lint` ne `validate` bunu yakalıyordu.
Ölçüm daha büyük bir boşluk gösterdi: repo genelinde **43 dosya** Prettier'dan geçmemişti, çünkü
`format` yalnız elle koşulan bir script'ti.

Üç adımda kapatıldı:

- `packages/core/scripts/generate-types.mjs` çıktısını `prettier.format` ile yazıyor
  (`resolveConfig` üzerinden, ileride bir `.prettierrc` eklenirse onurlansın diye). `gen` artık
  idempotent: iki kez koşup `--check`'ten geçiyor. C# tarafında karşılığı zaten vardı —
  `dotnet format --verify-no-changes` `gen`'e bağlı ve `Generated/Spec.cs`'i kapsıyor.
- `format:check` kapısı: root `turbo.json`'a `//#format:check` (cache'siz — biçim kapısının bayat
  cache'ten yeşil dönmesi kabul edilemez), `pnpm lint` artık `turbo run lint validate format:check`,
  ve CI'ın node job'ı aynı listeyi koşuyor. Kapsam `ts,tsx,md,mjs`; `.prettierignore` üçüncü parti
  skill içeriğini, `dist`'i, `sdks/dotnet`'i ve TanStack'in ürettiği `routeTree.gen.ts`'i dışlıyor.
- `pnpm format` bir kez koşuldu: 37 dosya biçimlendi (çoğu markdown tablo hizası ve test dosyası
  satır sarma; semantik değişiklik yok, `check-types` ve `lint` yeşil).

Kapı sayısı 23 → 24.

## Ertelenenler

- **Fastify adapter.** Dispatcher `httpAdapter.getInstance()`'ın çağrılabilir olduğunu varsayıyor;
  Express doğru, Fastify değil. Kapsam Express olarak sabitlendi.
- **`schema-conversion-rules.md` tablolarının Nest kaynak sütunu.** Nest bağlaması var ve çalışıyor,
  karşılıkları karar 012'de yazılı, ama tablolara taşınmadı. Doküman işi.
- **`caching.md`'nin dağıtık depo garantileri** — hiçbir SDK'da uygulanmadı; damga bu yüzden
  kapsamlandı.
- **CI'da net8.0 ayağı ve TS test job'ı** — TS testleri CI'a eklendi, net8.0 tam suite koşusu
  yerelde yapıldı.
