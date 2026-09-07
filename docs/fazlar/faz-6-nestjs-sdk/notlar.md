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
Nest'in var olmayan roles decorator'ı (`metadata-sozlesmesi.md` + `gorunurluk.md`, üç cümle), probe
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
— yani *bildirilmiş boş nesne*. `allowsAdditional` `false` döndüğü için `RequestComposer`'ın izin
listesi kapanıyordu: `Dictionary<string, object>` ve `Hashtable` değerleri "hiçbir şey kabul
etmiyor" olarak tarif ediliyordu, oysa her şeyi kabul ediyorlar. Düzeltme izin listesini *hiçbir
şeyden* *her şeye* genişlettiği için kendi testiyle sabitlendi (`J8e`).

**İki demo paritesi, dört kimlikle ölçüldü.** Aynı boş sorgu, aynı kullanıcılar:

| Kimlik | dotnet | Nest |
| ------ | ------ | ---- |
| alice | add_order_note, create_order, **get_health**, get_order, orders_get_receipt, orders_me, orders_ping, orders_summary | aynı, `get_health` hariç |
| bob | **get_health**, orders_get_receipt, orders_me, orders_ping, orders_summary | aynı, `get_health` hariç |
| carol | **get_health**, orders_audit, orders_get_receipt, orders_me, orders_ping, orders_summary | aynı, `get_health` hariç |

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
`hata-eslemesi.md` "Faz 6'da NestJS SDK'sının kendi metadata katmanı geldiğinde yeniden
değerlendirilir" diyordu; katalog gelince `knownFields` elde oldu ve mesajın baş token'ını kapalı
kümeye karşı eşlemek tahmin değil arama haline geldi.

**`net8.0`'da `K5_SingleFlight_ParallelSearches_ProbeOnce` yük altında flaky.** Tam suite
koşusunda bir kez düştü, yalıtımda 3/3 geçti. Benim değişikliklerimle ilgisi yok (cache ve
single-flight'a dokunulmadı); kayda geçsin diye yazıldı, düzeltilmedi.

## Ertelenenler

- **Fastify adapter.** Dispatcher `httpAdapter.getInstance()`'ın çağrılabilir olduğunu varsayıyor;
  Express doğru, Fastify değil. Kapsam Express olarak sabitlendi.
- **`sema-donusum-kurallari.md` tablolarının Nest kaynak sütunu.** Nest bağlaması var ve çalışıyor,
  karşılıkları karar 012'de yazılı, ama tablolara taşınmadı. Doküman işi.
- **`onbellek.md`'nin dağıtık depo garantileri** — hiçbir SDK'da uygulanmadı; damga bu yüzden
  kapsamlandı.
- **Nest'te `listChanged` fan-out'unun katalog reload'una bağlanması.** `SkMcpCatalog.reload()`
  dinleyicileri tetikliyor ve probe-disabled kümesini temizliyor, ama
  `SkMcpStreamableHttp.notifyToolListChanged()` çağrısı demo/host tarafında bağlanmadı.
- **Nest'te `_meta["sk-mcp/catalogGeneration"]` damgası** — MCP TS SDK'sının `registerTool`'u
  `_meta` yüzeyi vermiyor; asimetri kayda geçti.
- **`M8 aynası`** (dış soket bilgisinin sentetik isteğe yansıtılması). M9 kapandı, M8 kapanmadı.
- **`metadata-extraction` descriptor round-trip testi** (yarım B). Nest keşfi
  [discovery.spec.ts](../../../sdks/nestjs/test/discovery.spec.ts) ve
  [catalog.spec.ts](../../../sdks/nestjs/test/catalog.spec.ts) ile doğrulandı, ama her fixture'ın
  `input`'unu üreten bir host kurup deep-equal karşılaştırma yapılmadı.
- **CI'da net8.0 ayağı ve TS test job'ı** — TS testleri CI'a eklendi, net8.0 tam suite koşusu
  yerelde yapıldı.
