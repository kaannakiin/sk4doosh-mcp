# Karar 012 — Tip Şekli (TypeShape) ve Şema Kural Katmanı

Tarih: 2026-09-07. Durum: **kabul edildi, kodla kanıtlandı** — 21 `schema-simplification` fixture'ı
core TS'te (`simplifySchema`) ve C#'ta (`SchemaWriter`) ilk koşuda geçti; şema dönüşümü ilk kez
n=2.

## Sorun: çalışan kurallar pinlenemiyordu

2026-09-07 ölçümü ([sema-hatti-acik-bulgular.md](../sema-hatti-acik-bulgular.md))
`sema-donusum-kurallari.md`'nin Tablo 2-5'inin **tamamının kodda uygulandığını** gösterdi. Gerçek
boşluk başkaydı: bu kuralların hiçbiri conformance fixture'ıyla pinli değildi, yalnız
`SchemaMapperTests.cs` (C# reflection testleri) tutuyordu. Yani doküman "her SDK kod değil kural
yorumlar" diyordu ama kuralın kendisi tek bir dilde yaşıyordu.

Nedeni yapısal: dönüşümün girdisi bir CLR `Type`'dır ve saf JSON fixture'ıyla verilemez.

## Karar: ayrımı taşımak, kaldırmak değil

`sema-donusum-kurallari.md` zaten iki katman tanımlıyordu — **bağlama** (dile özgü reflection) ve
**kural** (dilden bağımsız çıktı şekli). Yapılan iş bu ayrımın **sınırını** değiştirmek oldu: araya
`packages/spec/schemas/type-shape.schema.json` girdi.

- Bağlama: dil tipi → **TypeShape**. Host testleriyle sınanır.
- Kural: TypeShape → JSON Schema. `schema-simplification` fixture'larıyla sınanır.

Ölçülen kazanç: Tablo 1-7'nin 34 satırından **22'si** fixture'lanabilir hale geldi (öncesi ~10).
Bağlamada kalan 12 satır, girdisi gerçekten bir `Type`/`PropertyInfo`/`ConstructorInfo` olanlardır.

`JsonSchemaMapper.cs` (397 satır) `TypeShapeBinder` + `SchemaWriter` olarak ikiye bölündü;
`JsonSchemaMapper` ~15 satırlık bir façade olarak yaşamaya devam ediyor, böylece `SchemaMapperTests`
ve tek seferlik host çağrıları derlenmeye devam etti. `SchemaWriter` static **değil**: `$defs`
torbasını sahiplenmek için endpoint başına örneklenir.

## IR'ın şeklini C# üreticisi belirledi

Bariz modelleme `oneOf` ile ayrıştırılmış bir `TypeNode` olurdu. Ama
`sdks/dotnet/scripts/generate-types.mjs` `type !== "object"` olan bir `$def`'i **sessizce atlıyor**
(`if (node.type !== "object") continue;`). Böyle bir düğüm hiç emit edilmez ve onu referans veren
her record var olmayan bir C# tipini adlandırır — derleme hatası, ama sebebi görünmez. CLAUDE.md
spec kavramları için elle tip yazmayı yasakladığı için IR **mevcut üretici değişmeden** emit
edilebilir olmak zorundaydı.

Sonuç: `TypeNode` tek düz kayıttır ve `kind` string enum'uyla ayrıştırılır; diğer tüm alanlar
opsiyoneldir. Maliyeti TS tip kesinliği, kazancı iki tarafta sıfır üretici değişikliği. Kaybedilen
kesinlik `validate.mjs`'e eklenen ~30 satırlık kind-başına şekil geçişiyle geri alındı (yeni
bağımlılık yok — paketin kuralı "runtime bağımlılığı yok", "mantık yok" değil).

Aynı turda üreticiye **yinelenen başlık guard'ı** eklendi: iki `$def` aynı adı farklı gövdeyle
taşırsa üretici artık fırlatıyor. Öncesinde ilki sessizce kazanıyordu.

## Nesnelerin satır içi biçimi yok

Her nesne tipi `types` tablosunda yaşar, `{"kind":"ref","ref":"<anahtar>"}` ile erişilir. Böylece
hoisting kararı saf bir `ref` özelliği olur ve "anonim nesne" vakası tamamen ortadan kalkar.

`types` anahtarı **stabil ve benzersizdir** (C#: `Type.FullName`; Nest: sınıf adı);
`ObjectType.name` ise `$defs` anahtarı olacak **basit görüntü adıdır**. Ayrım zorunlu: `$defs`
anahtarı olarak tam nitelikli ad kullanmak, C# `Sales.Orders.Order` ile Nest
`src/orders/order.dto.Order` için farklı anahtar üretip IR'ın bütün amacı olan dil-bağımsızlığı yok
ederdi.

## Kısıtlar kural-öncesi taşınır

`Constraints` `minSize`/`maxSize` taşır, `minLength`/`minItems` değil. Dizi-mi-string-mi çatalı bir
**kuraldır** (üyenin üretilmiş tipine bakar), bağlama gerçeği değil. Nitelik önceliği
(`[MinLength]`'in `[StringLength]`'i ezmesi) bağlamada kalır ve tek `minSize`'a çöker.

## Nest şema kaynağı: `class-validator` otoritedir

İki tasarım turu bu noktada ayrıştı; şema tarafı doğru çıktı.

Yönlendirici kısıt (faz-3 notları) *host'un kendi tipini adıyla okumayı* yasaklıyor — reddedilen
vaka bir host'un `RequirePermissionAttribute`'uydu. `class-validator` host'un tipi değildir: Nest'in
kendi `ValidationPipe`'ının tükettiği ekosistem standardıdır ve
`System.ComponentModel.DataAnnotations`'ın birebir yapısal karşılığıdır — ki `JsonSchemaMapper` onu
adıyla okur (`[Required]`, `[Range]`, `[MinLength]`). Simetriktir, ihlal değil.

Belirleyici argüman ayrıdır: **yalnız `class-validator` "bu alan gönderilmek zorunda mı?" sorusunu
cevaplayabilir** (`@IsOptional()` var/yok). `design:type` bunu yapısal olarak yapamaz, TS `?`
silinir. Tablo 5 `required`'ın yalnız açık bildirimden geldiğini söylüyor; `design:type`'tan çıkarım
**yanlış** olurdu, zayıf değil.

Ölçüm gerekliydi ve tahminimi düzeltti: `class-validator@0.14`'te metadata ayırıcısı `entry.type`
**değil** `entry.name`'dir — tüm `@IsX` dekoratörleri `type: "customValidation"` taşır. İlk yazım
`type`'a bakıyordu ve bütün kısıtları sessizce düşürüyordu; gerçek metadata dökülünce görüldü.

Merdiven, ilk eşleşen kazanır: (1) host beyanı `options.schema.typeShape`; (2) `@nestjs/swagger`
metadata'sı, **yalnız paket varsa** (anahtarla okunur, import yok, peer dependency yok);
(3) `class-validator` üye kümesi + `required` + kısıtlar; (4) `class-transformer` `@Type(() => X)`
ile iç içe/eleman tipi; (5) `design:type`; (6) hiçbiri → `unknown` düğümü.

`readOnly` ve `constructorBound` Nest'te her üye için `false`'tur — TS'te erozyona dayanan get-only
property kavramı yok. Tablo 4'ün düşme kuralı Nest'te no-op'tur; kural yine paylaşılan
fixture'larla koşar ve `readOnly: true` üreten tek bağlama .NET'inkidir.

## `unreadable_shape` uyarıdır, endpoint düşürmez

Emekliye ayrılan `non_object_body`'nin bilinçli tersi. O kod düşürüyordu çünkü endpoint **hiç
çağrılamıyordu** (karar 009). Opak gövde bunun tersidir: `additionalProperties: true` composer'ın
her bilinmeyen anahtarı iletmesini sağlar, yani tool zayıf sözleşmeyle **tam çağrılabilir** kalır.
Düşürmek gerileme olurdu. "Prod'da opak gövde olmasın" diyen host kodu `Diagnostics.Escalate`'e
ekler.

## Yan bulgu: `object` tipli üye "hiçbir şey kabul etmiyor" diyordu

Ölçümde çıktı. `object` tipli bir üye nesne dalına düşüp `{"type":"object","properties":{}}`
üretiyordu — `sema-donusum-kurallari.md`'ye göre bu *bildirilmiş boş nesne* demektir ve
`allowsAdditional` `false` döner, yani `RequestComposer`'ın izin listesi kapanır. Sonuç:
`Dictionary<string, object>` ve `Hashtable` değerleri "hiçbir şey kabul etmiyor" olarak tarif
ediliyordu, oysa her şeyi kabul ediyorlar. Bağlama artık `object` için `unknown` düğümü üretiyor,
yazıcı sınır nesnesi yazıyor. Değişiklik izin listesini *hiçbir şeyden* *her şeye* genişlettiği için
kendi testiyle sabitlendi (`J8e`).

## Reddedilen alternatifler

- **Şema → şema dönüşümü** (girdi ayrıntılı JSON Schema, çıktı sadeleştirilmiş). Ayrışma riski en
  yüksek kurallar tam da bu tasarımın ulaşamadıklarıydı: readonly üye düşmesi ve koleksiyon/ctor
  istisnaları (kuralın yokluğu çalışan bir argümanı `unknown_argument` yapar),
  `minSize`'ın dizi-mi-string-mi çatalı, ve enum tel biçimi. Bunlar sonsuza kadar n=1 host testi
  kalırdı — yani bu işin var olma sebebi çözülmemiş olurdu.
- **Hibrit** (üye/kısıt/enum için IR, sınır kuralları için şema→şema). İki fixture türü, SDK başına
  iki koşucu ve "aynı DTO"yu iki farklı şekilde ifade etme yolu gerektirirdi; ayrıca ayıracağı
  sınır kuralları (derinlik/döngü) karar 2 ile zaten siliniyordu, yani gerekçesi buharlaştı.
- **`oneOf` ile ayrıştırılmış `TypeNode`.** C# üreticisinin sessiz atlaması yüzünden imkânsız
  (yukarıya bkz). Üreticiyi `oneOf` union'larını anlayacak şekilde genişletmek ayrı ve büyük bir
  iştir; IR'ı düz tutmak bedavaydı.
- **`$defs` anahtarı olarak tam nitelikli ad.** Dil-bağımsızlığı yok eder (yukarıya bkz), ayrıca
  namespace'leri agent yüzeyine döker ve prompt gürültüsüdür.
- **`@nestjs/swagger`'ı zorunlu kılmak.** En zengin metadata ama her DTO'ya `@ApiProperty` yazmayı
  şart koşmak SDK'nın "mevcut backend'e ek annotation gerektirmez" iddiasını yalanlardı. Merdivenin
  opsiyonel basamağı olarak kaldı.
