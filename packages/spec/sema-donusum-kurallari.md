# Şema Dönüşüm Kuralları

> Statü: **kural katmanı normatif, bağlama kısmen.** TypeShape → JSON Schema kuralları iki
> bağımsız implementasyonla doğrulandı (ASP.NET `SchemaWriter` + TS `simplifySchema`) ve
> [conformance/schema-simplification/](../conformance/schema-simplification/) korpusu ikisini de
> bayt bayt pinliyor. Bağlama katmanının **iki** implementasyonu var (CLR reflection ve Nest
> decorator metadata'sı) ama aşağıdaki tabloların "kaynak" sütunları yalnız C# tarafını listeliyor;
> Nest karşılıkları [karar 012](../../docs/kararlar/012-tip-sekli-ve-sema-kural-katmani.md)'de
> yazılıdır ve tabloya taşınmadı. Bağlama tanım gereği saf JSON fixture'ıyla sınanamaz, her SDK'nın
> host testleriyle sınanır.

Backend'in tip sistemindeki bir gövde/parametre tipinin JSON Schema'ya nasıl indirgeneceğini
tanımlar. Hat: dil tipi → **TypeShape** → `EndpointDescriptor.requestBody.schema` →
`ToolDefinition.inputSchema` ([metadata-sozlesmesi.md](metadata-sozlesmesi.md) son adımı tanımlar,
bu döküman ilk ikisini).

Dönüşüm iki katmandır ve ayrımı normatiftir:

- **Bağlama (binding)**: dile özgü reflection. Girdisi bir CLR `Type`, bir TS decorator kaydı ya da
  bir host beyanıdır. Çıktısı [schemas/type-shape.schema.json](schemas/type-shape.schema.json)'a
  uyan bir **TypeShape**'tir. Her SDK'nın kendi host testleriyle sınanır.
- **Kural**: dilden bağımsız. Girdisi TypeShape, çıktısı JSON Schema. Tüm SDK'lar birebir aynı
  çıktıyı üretmek zorundadır ve `schema-simplification` fixture'ları bunu sınar.

Ayrımın sınırı bilinçli olarak buraya konuldu: bir CLR `Type`'ı saf JSON fixture'ıyla veremezsiniz,
ama bir **üye listesini** verebilirsiniz. Böylece Tablo 1-7'nin 34 satırının 22'si fixture'lanabilir
hale geldi; bağlamada kalan 12 satır girdisi gerçekten dile özgü olanlardır.

## TypeShape

Adlı tip tablosu (`types`) ve bir kök düğüm (`root`). Nesnelerin **satır içi biçimi yoktur**: her
nesne tipi `types`'ta yaşar ve `{"kind":"ref","ref":"<anahtar>"}` ile erişilir. `types` anahtarı
**stabil ve benzersizdir** (C#: `Type.FullName`; Nest: `<modül>.<SınıfAdı>`); `ObjectType.name` ise
`$defs` anahtarı olacak **basit görüntü adıdır**. Bu ayrım hem hoisting'i deterministik yapar hem
`$defs` anahtarlarını dil-bağımsız tutar — tam nitelikli ad kullanmak aynı kavramsal tip için iki
SDK'da iki farklı anahtar üretirdi.

`TypeNode` tek düz kayıttır ve `kind` ile ayrıştırılır; her düğüm türünün hangi alanları taşıyıp
taşımayacağı `pnpm validate`'in kind başına şekil geçişiyle sınanır.

## Tablo 1 — Karar sırası

Sıra normatiftir; ilk eşleşen dal kazanır.

| #   | Dal         | Koşul            | Çıktı                                                                       |
| --- | ----------- | ---------------- | --------------------------------------------------------------------------- |
| 0   | host beyanı | `kind: verbatim` | `schema`, derin kopya                                                       |
| 1   | ikili       | `kind: binary`   | `{"type":"string","contentEncoding":"base64"}`                              |
| 2   | skaler      | `kind: scalar`   | Tablo 2                                                                     |
| 3   | enum        | `kind: enum`     | Tablo 3                                                                     |
| 4   | map         | `kind: map`      | `{"type":"object","additionalProperties":<değer şeması>}` + `propertyNames` |
| 5   | dizi        | `kind: array`    | `{"type":"array","items":<eleman şeması>}`                                  |
| 6   | başvuru     | `kind: ref`      | satır içi nesne, ya da hoist edilmişse `{"$ref":"#/$defs/<ad>"}`            |
| 7   | okunamayan  | `kind: unknown`  | `{"type":"object","additionalProperties":true}` + `unreadable_shape`        |

**Map dizi'den önce gelmek zorundadır.** Sözlükler anahtar/değer çiftlerinin sıralanabiliri olarak
da görünür; dizi dalı önce gelirse her sözlük `[{"key":…,"value":…}]` olarak tarif edilir ve şemaya
uyan hiçbir JSON değeri backend'i geçemez. IR'da ayrım zaten `kind` ile çözülmüştür — ama **bağlama
katmanında** ayrımın arayüz tabanlı olması hâlâ zorunludur: anahtar/değer çifti elemanı taşıyan
gerçek bir dizi (`List<KeyValuePair<…>>`) map değildir ve dizi kalmalıdır.

Sınır çıktısı `additionalProperties: true` taşır: bu, "nesne, şekli bilinmiyor" demektir ve
bildirilmiş boş nesneden (`properties: {}`) ayırt edilebilir. Ayrım işlevseldir, kozmetik değil:
`RequestComposer`'ın izin listesi bu bayraktan beslenir, dolayısıyla `properties: {}` "hiçbir anahtar
kabul edilmiyor" anlamına gelir. Şekli okunamayan bir tip için o çıktıyı yazmak endpoint'i sessizce
çağrılamaz yapar.

## Tablo 2 — Skaler sözlüğü

`ScalarKind` + opsiyonel `format` → şema. Kaynak sütunları bağlamadır.

| Şema                                           | `ScalarKind`/`format`  | C# kaynağı                                                         |
| ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| `{"type":"string"}`                            | `string`               | `string`, `char`, `TimeOnly`, `TimeSpan`, `Uri`                    |
| `{"type":"boolean"}`                           | `boolean`              | `bool`                                                             |
| `{"type":"integer"}`                           | `integer`              | `byte`, `sbyte`, `short`, `ushort`, `int`, `uint`, `long`, `ulong` |
| `{"type":"number"}`                            | `number`               | `float`, `double`, `decimal`                                       |
| `{"type":"string","format":"uuid"}`            | `string` + `uuid`      | `Guid`                                                             |
| `{"type":"string","format":"date-time"}`       | `string` + `date-time` | `DateTime`, `DateTimeOffset`                                       |
| `{"type":"string","format":"date"}`            | `string` + `date`      | `DateOnly`                                                         |
| `{"type":"string","contentEncoding":"base64"}` | `kind: binary`         | `byte[]`, `Memory<byte>`, `ReadOnlyMemory<byte>`                   |

Skaler sözlüğünde bulunmayan ve nesne de olmayan tipler (`object`, okunamayan üyeler) `unknown`
düğümüdür, boş nesne değil.

## Tablo 3 — Enum tel biçimi

Tel biçimi **host'un serileştiricisine sorularak** belirlenir, tahmin edilmez: her üye host'un kendi
ayarlarıyla serileştirilir ve sonucun türü okunur. Bu, üye düzeyindeki yeniden adlandırmaları ve
isimlendirme politikasını da yakalar. Bağlama bu ölçümü `EnumFacts`'e yazar
(`wireForm`, `combinable`, `names`, `numbers`); kural yalnız `EnumFacts`'i okur.

| `wireForm` / `combinable`   | Şema                                               | Tanı                     |
| --------------------------- | -------------------------------------------------- | ------------------------ |
| `string`                    | `{"type":"string","enum":[<wire adları>]}`         | —                        |
| `integer`                   | `{"type":"integer","enum":[<sayısal değerler>]}`   | —                        |
| `combinable: true` (flags)  | yalnız `type` — `enum` **yazılmaz**                | —                        |
| `unresolved`                | `{"anyOf":[string biçimi, integer biçimi]}`        | `enum_format_unresolved` |
| `unresolved` + `combinable` | `{"anyOf":[{"type":"string"},{"type":"integer"}]}` | `enum_format_unresolved` |

Flags enum'da `enum` listesi yazmak yasal her bit kombinasyonunu reddeder; bu yüzden liste düşer.
Okunamayan host için `anyOf` bir kaçamak değil, doğru ifadedir: o host adı da sayıyı da kabul eder.
Bu yüzden `anyOf` **evrensel geri düşüş değildir** — politikası okunabilen host yalnız bir biçimi
kabul eder.

## Tablo 4 — Üye kuralları

IR her üyede üç bağlama gerçeği taşır: `readOnly`, `constructorBound` ve üyenin tip düğümü. Kural
bu üçünden karar verir.

| `readOnly` | `constructorBound` | Üye tipi            | Davranış                                            |
| ---------- | ------------------ | ------------------- | --------------------------------------------------- |
| `false`    | —                  | —                   | şemada                                              |
| `true`     | `false`            | `array` ya da `map` | şemada — serileştirici mevcut örneği doldurur       |
| `true`     | `true`             | —                   | şemada — constructor parametresine karşılık geliyor |
| `true`     | `false`            | diğer               | **düşer** — sunucu hesaplı denetim alanı            |

Salt-okunur koleksiyon istisnası zorunludur: onsuz gerçekten yazılabilen bir alan şemadan ve
dolayısıyla `RequestComposer`'ın izin listesinden düşer, çalışan bir argüman `unknown_argument` olur.

Düşürme `dropReadOnlyProperties` ile kapatılabilir (default açık); indeksleyici ve okunamaz üyeler
IR'a hiç girmez, dolayısıyla kuralın konusu değildir.

Üye sırası: önce taban tipin üyeleri, sonra türetilmiş tipinkiler; her tip içinde bildirim sırası.
Sıra normatiftir — `required` dizisi ve fixture karşılaştırması sıraya duyarlıdır, reflection'ın
doğal sırası ise garanti edilmez. Sırayı **bağlama** üretir, **kural** korur.

## Tablo 5 — `required` ve kısıtlar

`required` yalnız **açık bildirimden** üretilir. Nullable olmama tek başına `required` anlamına
**gelmez**: "null olamaz" ile "gönderilmek zorunda" farklı sorulardır ve gövde alanlarında
framework'ler ikincisini uygulamaz.

Kısıtlar IR'da **nötr adlarla** taşınır; JSON Schema anahtarına çevrim bir **kuraldır**, çünkü hangi
anahtara gideceği üyenin üretilmiş tipine bağlıdır.

| IR kısıtı             | Üretilen tip                                  | JSON Schema                                        | C# kaynağı                                     |
| --------------------- | --------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `required: true`      | —                                             | `required` girdisi                                 | `[Required]`, `required` değiştiricisi         |
| `minSize` / `maxSize` | `array`                                       | `minItems` / `maxItems`                            | koleksiyonda `[MinLength]`/`[MaxLength]`       |
| `minSize` / `maxSize` | diğer                                         | `minLength` / `maxLength`                          | `[MinLength]`, `[MaxLength]`, `[StringLength]` |
| `minimum` / `maximum` | `integer`, `number`                           | `minimum` / `maximum`                              | `[Range]`                                      |
| `minimum` / `maximum` | diğer                                         | **yazılmaz**                                       | —                                              |
| `pattern`             | `string`                                      | `pattern`                                          | `[RegularExpression]`                          |
| `pattern`             | diğer                                         | **yazılmaz**                                       | —                                              |
| `format`              | `string`, şema kendi `format`'ını taşımıyorsa | `format`                                           | `[EmailAddress]` → `email`, `[Url]` → `uri`    |
| `description`         | —                                             | `description`, şema kendi açıklamasını taşımıyorsa | `[Description]`                                |

**Nitelik okuması üyeyle sınırlı kalamaz.** Serileştiricinin seçtiği parametreli bir constructor
varsa, adı eşleşen parametrenin nitelikleri de okunur; üye üzerindekiler çakışmada kazanır.
Konumsal record'larda `[Required]`/`[Range]` gibi nitelikler `property:` hedefi taşımadıkları sürece
**üyeye değil constructor parametresine** bağlanır; yalnız üyeye bakan bir uygulama hiçbirini
görmez. Bu kural bu dökümandaki en yüksek değerli bağlama kuralıdır.

Constructor seçimi belirsizse (aynı genişlikte birden çok aday) korelasyon **yapılmaz**; belirsizlik
sessizce çözülmez.

`required` iç içe şemalarda yalnız boş değilken yazılır; kök `inputSchema`'da boş olsa bile yazılır
([metadata-sozlesmesi.md](metadata-sozlesmesi.md)). Asimetri bilinçlidir: kök, fixture'la bayt bayt
karşılaştırılan agent sözleşmesidir; iç içe şemalar betimleyici yüktür.

Çevrilemeyen kısıtlar (`[Compare]`, `[CreditCard]`, `[Phone]`, özel doğrulayıcılar) IR'a hiç
girmez. Uydurma bir çeviri, istemcinin geçerli girdiyi sunucuya hiç ulaşmadan reddetmesine yol
açar.

`default` bilinçli olarak yazılmaz — IR'da böyle bir alan yoktur, yani kural yapısal olarak
dayatılmıştır. Gerekçe: modeli varsayılanı açıkça göndermeye davet eder, oysa PATCH gövdesinde
"yok" ile "açıkça varsayılan" farklı isteklerdir.

## `$defs` ve hoisting

Derinlik sınırı **yoktur**. İç içe geçme tamamen açılır; sonlanmayı `$defs` tablosu garanti eder,
çünkü her adlı tip en fazla bir kez yazılır. Döngü opak nesneye indirgenmez, `$ref` ile ifade
edilir — bilgi kaybı yoktur ve `$defs`/`$ref` JSON Schema 2020-12'nin çekirdek kelime dağarcığıdır.

**Hoisting yüklemi:** bir adlı nesne tipi **birden fazla kullanılıyorsa ya da bir döngüye giriyorsa**
`$defs`'e taşınır ve kullanım yerinde `{"$ref":"#/$defs/<ad>"}` yazılır. Tam bir kez kullanılan ve
döngüye girmeyen tip satır içi kalır; sığ DTO'nun düz kalması okunurluk kazancıdır.

**Kök her zaman satır içidir.** Hoist edilmiş bir kök `inputSchema`'yı `{"$ref":…}` yapardı; oysa
`inputSchema` her zaman düz bir nesnedir (Tablo 6) ve gövde alanlarının üst seviyeye düzleşmesi buna
bağlıdır. Kök tip aynı zamanda kendine döngülüyse `$defs`'e **ayrıca** yazılır ve içteki başvurular
oraya bakar; bedeli döngülü kök başına bir kopya gövdedir.

**Sayma kapsamı endpoint başına tek TypeShape'in tamamıdır**, şema kökü başına değil. Bir query
parametresinin tipi ile gövdenin tipi aynı tipi birer kez referans veriyorsa sayı ikidir ve tip
hoist edilir. Bu cümle normatiftir: kapsamı kök başına okuyan bir uygulama tüm fixture korpusunu
geçer (her fixture'ın tek kökü var) ama gerçek bir katalogda ayrışır.

`$defs` her şema-değerli yuvanın kökünde yaşar, yalnız o kökten erişilebilen alt kümeyle.
`inputSchema` üretilirken parametre şemalarının ve gövde şemasının torbaları anahtara göre
birleştirilir: aynı anahtar + aynı gövde → biri kalır; aynı anahtar + farklı gövde →
`schema_def_conflict`, endpoint düşer.

**`$defs` anahtar sırası ordinal artandır.** Keşif sırası yürüme sırasına bağlı olurdu ve iki SDK'nın
traversal'ını birebir eşlemeyi gerektirirdi; `$defs` bir torba olduğu için sıralamak semantik olarak
bedavadır. Sıra fixture'da açıkça `defsOrder` ile pinlenir, çünkü iki koşucunun da derin eşitliği
nesne anahtar sırasını görmez.

**Anahtar çakışması:** iki hoist edilmiş tip aynı basit adı taşıyorsa `types` anahtarları ordinal
sıralanır; ilki çıplak adı korur, sonrakiler `<Ad>_2`, `<Ad>_3` alır ve
`schema_def_name_disambiguated` üretilir. Sessiz çözüm değildir — tanı vardır — ve ölümcül değildir,
çünkü `$defs` anahtarı doküman-yereldir ve hiçbir tool'u yanlış adresleyemez.

`$defs` anahtarları host tip adlarının basit hâlidir. Bu bilinçli bir ödünleşmedir: tip adları
`[Description]` metniyle ve `container`'dan türeyen tool prefix'leriyle zaten agent yüzeyine
ulaşıyor, ve [gorunurluk.md](gorunurluk.md) değişmez 3 **policy** adları hakkındadır, tip adları
hakkında değil. Ada karışmak isteyen host `Schema.TypeName` ile yeniden adlandırır.

## Derinlik bütçesi (kural değil, host politikası)

`maxDepth` **doğruluk sınırı değildir**; ayarlanmadığında (default) derinlik sınırsızdır. Host
bağlam-boyutu kaygısıyla bir bütçe koyabilir: o zaman bütçeye ulaşan dal sınır nesnesine indirilir
ve `schema_depth_truncated` üretilir. Hoisting _recursion_'ı sınırlar, _genişliği_ sınırlamaz —
onlarca farklı tek-kullanımlık DTO tek bir büyük `inputSchema`'ya açılabilir; bütçe bunun içindir.

Hiçbir SDK bütçenin varlığına ya da bir default değerine güvenmemelidir.

## Tablo 6 — Gövde kökü

`inputSchema` her zaman düz bir nesnedir; MCP tool argümanları JSON nesnesidir.

| Gövde kök şeması                            | Davranış                                               |
| ------------------------------------------- | ------------------------------------------------------ |
| `type: object`, `properties` var            | alanlar üst seviyeye düzleşir                          |
| `type: object`, `additionalProperties` açık | gövde serbest; bilinmeyen anahtarlar iletilir          |
| dizi ya da skaler kök                       | sentetik tek argüman `body`; `synthetic_body_argument` |
| `type` yok (host beyanı)                    | nesne gibi ele alınır                                  |
| birden çok gövde bildirimi                  | endpoint **düşer**, `multiple_body_bindings`           |

**Sentetik gövde kökü.** Nesne olmayan bir gövde kökü (`[FromBody] List<int>`, `[FromBody] string`)
endpoint'i düşürmez. `inputSchema` tek bir `body` property'si taşır, şeması kökün kendisidir ve
`required` listesine girer; `inputSchema.additionalProperties` `false`'tur. Çağrı anında `body`
argümanının değeri **gövdenin tamamı** olarak gönderilir; `body` gelmezse gövde hiç gönderilmez ve
kararı backend'in model binder'ı verir ([arguman-eslemesi.md](arguman-eslemesi.md)).

Ad, parametre adlarına karşı aynı çakışma denetiminden geçer: `body` adlı bir parametre varsa
`argument_collision` üretilir ve endpoint düşer. Şablon aynı anda hem gövde kökü hem gövde alanı
bildiremez (`conflicting_body_modes`).

Emekliye ayrılan `non_object_body` kodu **yeniden kullanılmaz**: eski anlamı "bu endpoint hiç
çağrılamaz" idi ve artık çağrılabilir.

`inputSchema.additionalProperties`, gövdenin serbest olup olmadığından **türetilir**; sabit
yazılmaz. Aynı yüklem hem şemayı hem `RequestComposer`'ın izin listesini besler — ikisi ayrışırsa
şema, composer'ın uymadığı bir sözleşme ilan eder. Gövde kökü de aynı disiplindedir: kök şemanın
nesne olmaması hem `body` argümanını hem composer'ın ikinci gövde modunu tetikler.

## Tablo 7 — Tanılar

| Kod                             | Ne zaman                                                     | Sonuç                 |
| ------------------------------- | ------------------------------------------------------------ | --------------------- |
| `argument_collision`            | parametre adı ile gövde alanı ya da gövde kökü adı çakışıyor | endpoint düşer        |
| `multiple_body_bindings`        | birden çok gövde bildirimi                                   | endpoint düşer        |
| `unsupported_binding`           | form/dosya bağlaması                                         | endpoint düşer        |
| `unsupported_method`            | HTTP metodunun nötr modelde karşılığı yok                    | endpoint düşer        |
| `schema_def_conflict`           | aynı `$defs` anahtarı farklı gövdeyle iki kez tanımlı        | endpoint düşer        |
| `synthetic_body_argument`       | nesne olmayan gövde kökü `body` argümanına sarıldı           | uyarı                 |
| `unsupported_dictionary_key`    | serileştirilemeyen sözlük anahtarı                           | değer şekli düşer     |
| `unreadable_shape`              | bağlama katmanı şekli okuyamadı                              | sınır nesnesi yazılır |
| `schema_def_name_disambiguated` | iki hoist edilmiş tip aynı basit adı taşıyor                 | uyarı, sonek eklenir  |
| `schema_depth_truncated`        | host derinlik bütçesi bir dalı kesti                         | uyarı                 |
| `enum_format_unresolved`        | enum tel biçimi okunamıyor                                   | uyarı                 |
| `naming_policy_unresolved`      | alan adı politikası okunamıyor                               | uyarı                 |

Şiddet üç kademelidir: `Warning`, `EndpointDropped`, `Fatal`. `Fatal` yalnız katalogun tamamını
tutarsız yapan kodlar içindir (aynı ada iki endpoint talip). Argüman çakışması **lokaldir** — tek
endpoint kullanılamaz, kataloğun kalanı sağlamdır — bu yüzden `Fatal` değildir; aksi halde tek bir
bozuk DTO yüzlerce tool'u birden düşürürdü.

`unreadable_shape` bilinçli olarak **uyarıdır**, endpoint düşürmez. Emekliye ayrılan
`non_object_body`'nin tersidir: o kod düşürüyordu çünkü endpoint hiç çağrılamıyordu; opak gövde ise
`additionalProperties: true` sayesinde her bilinmeyen anahtarı ilettiği için tool zayıf sözleşmeyle
**tam çağrılabilir** kalır. Düşürmek gerileme olurdu. "Prod'da opak gövde olmasın" diyen host kodu
`Diagnostics.Escalate`'e ekler.

## Pinlenmemiş alanlar

Aşağıdakiler bilinçli olarak tanımsız ya da kapsam dışıdır; uygulama bunlara güvenmemelidir.

- **Nullable gösterimi.** Referans tipi nullability'si okunmaz; değer tipi sarmalayıcısı açılır ve
  `null` şemaya yansımaz. IR'ın nullable düğümü yoktur. `required` bundan beslenmediği için doğruluk
  bağımlılığı da yoktur. Kapsam dışı bırakılmasının ikinci gerekçesi yapısaldır: TypeScript'te
  çalışma zamanında nullability diye bir şey yoktur, dolayısıyla bu kuralın ikinci bir
  implementasyonla doğrulanması mümkün değildir.
- **Host doküman yorumları.** Bağlama katmanı bir üye açıklamasını host'un kendi doküman
  kaynağından okuyabilir; kural katmanı yalnız IR'ın `description` alanını görür. Hangi kaynağın
  okunacağı bağlamaya aittir ve normatif değildir — C# bugün yalnız `[Description]` okur, XML doc
  okumaz.
- **Derinlik bütçesinin default değeri** (yukarıya bkz). Bütçenin _davranışı_ pinlidir, varlığı ve
  değeri host politikasıdır.
