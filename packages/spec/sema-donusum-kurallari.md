# Şema Dönüşüm Kuralları

> Statü: **hipotez v0** — iki bağımsız doğrulaması (iki backend / iki framework) olmayan kural normatif değildir. Bugün yalnız ASP.NET Core uygulaması var; aşağıdaki tablolar NestJS SDK'sının uygulaması gereken sözleşmedir.

Backend'in tip sistemindeki bir gövde/parametre tipinin JSON Schema'ya nasıl indirgeneceğini tanımlar. Hat: CLR/DTO tipi → `EndpointDescriptor.requestBody.schema` → `ToolDefinition.inputSchema` ([metadata-sozlesmesi.md](metadata-sozlesmesi.md) son adımı tanımlar, bu döküman ilk adımı).

Dönüşüm iki katmandır ve ayrımı normatiftir:

- **Bağlama (binding)**: dile özgü reflection. Saf JSON fixture'ıyla sınanamaz — girdisi bir CLR `Type`'dır. Her SDK'nın kendi host testleriyle sınanır. Aşağıdaki "kaynak" sütunları bağlamadır.
- **Kural**: dilden bağımsız. Üretilen şemanın şekli. Tüm SDK'lar birebir aynı çıktıyı üretmek zorundadır.

## Karar sırası

Sıra normatiftir; ilk eşleşen dal kazanır. Sıranın kendisi kuraldır, çünkü çoğu tip birden fazla dala uyar — bir sözlük aynı zamanda bir koleksiyondur.

| # | Dal | Koşul | Çıktı |
| - | --- | ----- | ----- |
| 0 | nullable açma | değer tipi sarmalayıcı | sarmalanan tiple devam |
| 1 | ikili | ikili yığın tipi | `{"type":"string","contentEncoding":"base64"}` |
| 2 | skaler | skaler sözlüğünde | Tablo 2 |
| 3 | enum | enum tipi | Tablo 3 |
| 4 | map | map benzeri arayüz | `{"type":"object","additionalProperties":<değer şeması>}` |
| 5 | dizi | başka türlü sıralanabilir | `{"type":"array","items":<eleman şeması>}` |
| 6 | sınır | derinlik ≥ `maxDepth` ya da döngü | `{"type":"object","additionalProperties":true}` |
| 7 | nesne | diğer | `{"type":"object","properties":{…}}` |

**Map dizi'den önce gelmek zorundadır.** Sözlükler anahtar/değer çiftlerinin sıralanabiliri olarak da görünür; dizi dalı önce gelirse her sözlük `[{"key":…,"value":…}]` olarak tarif edilir ve şemaya uyan hiçbir JSON değeri backend'i geçemez.

**Map ayrımı arayüz tabanlı olmak zorundadır, eleman tipine bakılarak yapılamaz.** Anahtar/değer çifti elemanı taşıyan gerçek bir dizi (`List<KeyValuePair<…>>`) map değildir ve dizi kalmalıdır.

Sınır çıktısı `additionalProperties: true` taşır: bu, "nesne, şekli bilinmiyor" demektir ve bildirilmiş boş nesneden (`properties: {}`) ayırt edilebilir. Yeni kelime dağarcığı icat edilmez.

## Tablo 2 — Skaler sözlüğü

| Şema | C# kaynağı |
| ---- | ---------- |
| `{"type":"string"}` | `string`, `char`, `TimeOnly`, `TimeSpan`, `Uri` |
| `{"type":"boolean"}` | `bool` |
| `{"type":"integer"}` | `byte`, `sbyte`, `short`, `ushort`, `int`, `uint`, `long`, `ulong` |
| `{"type":"number"}` | `float`, `double`, `decimal` |
| `{"type":"string","format":"uuid"}` | `Guid` |
| `{"type":"string","format":"date-time"}` | `DateTime`, `DateTimeOffset` |
| `{"type":"string","format":"date"}` | `DateOnly` |
| `{"type":"string","contentEncoding":"base64"}` | `byte[]`, `Memory<byte>`, `ReadOnlyMemory<byte>` |

## Tablo 3 — Enum tel biçimi

Tel biçimi **host'un serileştiricisine sorularak** belirlenir, tahmin edilmez. Her üye host'un kendi ayarlarıyla serileştirilir ve sonucun türü okunur. Bu, üye düzeyindeki yeniden adlandırmaları ve isimlendirme politikasını da yakalar; SDK adı kendi türetmez.

| Host politikası | Şema | Tanı |
| --------------- | ---- | ---- |
| adlar wire'da | `{"type":"string","enum":[<wire adları>]}` | — |
| sayılar wire'da | `{"type":"integer","enum":[<sayısal değerler>]}` | — |
| birleştirilebilir (flags) | yalnız `type` — `enum` **yazılmaz** | — |
| okunamıyor | `{"anyOf":[string biçimi, integer biçimi]}` | `enum_format_unresolved` |

Flags enum'da `enum` listesi yazmak yasal her bit kombinasyonunu reddeder; bu yüzden liste düşer.

Okunamayan host için `anyOf` bir kaçamak değil, doğru ifadedir: o host adı da sayıyı da kabul eder. Bu yüzden `anyOf` **evrensel geri düşüş değildir** — politikası okunabilen host yalnız bir biçimi kabul eder.

## Tablo 4 — Üye kuralları

| Üye özelliği | Davranış |
| ------------ | -------- |
| yazılabilir | şemada |
| salt-okunur, koleksiyon/map | şemada — serileştirici mevcut örneği doldurur |
| salt-okunur, constructor parametresine karşılık geliyor | şemada |
| salt-okunur, diğer | **düşer** — sunucu hesaplı denetim alanı |
| indeksleyici ya da okunamaz | düşer |

Salt-okunur koleksiyon istisnası zorunludur: onsuz gerçekten yazılabilen bir alan şemadan ve dolayısıyla `RequestComposer`'ın izin listesinden düşer, çalışan bir argüman `unknown_argument` olur.

Üye sırası: önce taban tipin üyeleri, sonra türetilmiş tipinkiler; her tip içinde bildirim sırası. Sıra normatiftir — `required` dizisi ve fixture karşılaştırması sıraya duyarlıdır, reflection'ın doğal sırası ise garanti edilmez.

## Tablo 5 — `required` ve kısıtlar

`required` yalnız **açık bildirimden** üretilir. Nullable olmama tek başına `required` anlamına **gelmez**: "null olamaz" ile "gönderilmek zorunda" farklı sorulardır ve gövde alanlarında framework'ler ikincisini uygulamaz.

| Kısıt | JSON Schema | C# kaynağı |
| ----- | ----------- | ---------- |
| gereklilik | `required` girdisi | `[Required]`, `required` değiştiricisi |
| uzunluk | `minLength`/`maxLength` | `[MinLength]`, `[MaxLength]`, `[StringLength]` |
| eleman sayısı | `minItems`/`maxItems` | koleksiyonda `[MinLength]`/`[MaxLength]` |
| aralık | `minimum`/`maximum` | `[Range]` |
| desen | `pattern` | `[RegularExpression]` |
| biçim | `format` | `[EmailAddress]` → `email`, `[Url]` → `uri` |
| açıklama | `description` | `[Description]` |

**Nitelik okuması üyeyle sınırlı kalamaz.** Serileştiricinin seçtiği parametreli bir constructor varsa, adı eşleşen parametrenin nitelikleri de okunur; üye üzerindekiler çakışmada kazanır. Konumsal record'larda `[Required]`/`[Range]` gibi nitelikler `property:` hedefi taşımadıkları sürece **üyeye değil constructor parametresine** bağlanır; yalnız üyeye bakan bir uygulama hiçbirini görmez. Bu kural bu dökümandaki en yüksek değerli bağlama kuralıdır.

Constructor seçimi belirsizse (aynı genişlikte birden çok aday) korelasyon **yapılmaz**; belirsizlik sessizce çözülmez.

`required` iç içe şemalarda yalnız boş değilken yazılır; kök `inputSchema`'da boş olsa bile yazılır ([metadata-sozlesmesi.md](metadata-sozlesmesi.md)). Asimetri bilinçlidir: kök, fixture'la bayt bayt karşılaştırılan agent sözleşmesidir; iç içe şemalar betimleyici yüktür.

Çevrilemeyen kısıtlar (`[Compare]`, `[CreditCard]`, `[Phone]`, özel doğrulayıcılar) **yazılmaz**. Uydurma bir çeviri, istemcinin geçerli girdiyi sunucuya hiç ulaşmadan reddetmesine yol açar.

`default` bilinçli olarak yazılmaz: modeli varsayılanı açıkça göndermeye davet eder, oysa PATCH gövdesinde "yok" ile "açıkça varsayılan" farklı isteklerdir.

## Tablo 6 — Gövde kökü

`inputSchema` her zaman düz bir nesnedir; MCP tool argümanları JSON nesnesidir.

| Gövde kök şeması | Davranış |
| ---------------- | -------- |
| `type: object`, `properties` var | alanlar üst seviyeye düzleşir |
| `type: object`, `additionalProperties` açık | gövde serbest; bilinmeyen anahtarlar iletilir |
| dizi ya da skaler kök | endpoint **düşer**, `non_object_body` |
| birden çok gövde bildirimi | endpoint **düşer**, `multiple_body_bindings` |

Dizi/skaler kökler için sentetik tek argüman tel biçimi **pinlenmemiş alandır**; bugün böyle bir endpoint zaten çağrılamaz durumdadır (gövde gönderilmez ve izin listesi boş kaldığı için her argüman reddedilir), dolayısıyla düşürmek katı iyileşmedir.

`inputSchema.additionalProperties`, gövdenin serbest olup olmadığından **türetilir**; sabit yazılmaz. Aynı yüklem hem şemayı hem `RequestComposer`'ın izin listesini besler — ikisi ayrışırsa şema, composer'ın uymadığı bir sözleşme ilan eder.

## Tablo 7 — Tanılar

| Kod | Ne zaman | Sonuç |
| --- | -------- | ----- |
| `argument_collision` | parametre adı ile gövde alanı adı çakışıyor | endpoint düşer |
| `non_object_body` | gövde kökü nesne değil | endpoint düşer |
| `multiple_body_bindings` | birden çok gövde bildirimi | endpoint düşer |
| `unsupported_binding` | form/dosya bağlaması | endpoint düşer |
| `unsupported_dictionary_key` | serileştirilemeyen sözlük anahtarı | değer şekli düşer |
| `enum_format_unresolved` | enum tel biçimi okunamıyor | uyarı |
| `naming_policy_unresolved` | alan adı politikası okunamıyor | uyarı |

Şiddet üç kademelidir: `Warning`, `EndpointDropped`, `Fatal`. `Fatal` yalnız katalogun tamamını tutarsız yapan kodlar içindir (aynı ada iki endpoint talip). Argüman çakışması **lokaldir** — tek endpoint kullanılamaz, kataloğun kalanı sağlamdır — bu yüzden `Fatal` değildir; aksi halde tek bir bozuk DTO yüzlerce tool'u birden düşürürdü.

## Pinlenmemiş alanlar

Aşağıdakiler bilinçli olarak tanımsızdır; uygulama bunlara güvenmemelidir.

- **Nullable gösterimi.** Referans tipi nullability'si okunmaz; `int?` sarmalayıcısı açılır ve `null` şemaya yansımaz. `required` bundan beslenmediği için doğruluk bağımlılığı yoktur.
- **XML doc yorumları.** Yalnız `[Description]` okunur.
- **Generic sarmalayıcı soyma**, **`$ref` ile recursion**, **derinlik sınırında inline etme.** Bugün derinlik ve döngü sınırı tek bir "şekli bilinmiyor" nesnesine indirger.
- **Dizi/skaler gövde kökü için tel biçimi** (Tablo 6).
