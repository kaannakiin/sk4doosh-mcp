# Karar 011 — NestJS Görünürlüğü ve Probe

Tarih: 2026-09-07. Durum: **kabul edildi, kodla kanıtlandı** (sdk-nestjs 204/204; meta-tool matrisi
[meta-tools.spec.ts](../../sdks/nestjs/test/meta-tools.spec.ts), katalog
[catalog.spec.ts](../../sdks/nestjs/test/catalog.spec.ts)).

## Ana bulgu: Nest'in statik yetki yüzeyi boş, ve cevap bu

`docs/nasil-calisiyor.md` Nest'te görünürlük için iki aday yol yazıyordu ve seçmiyordu. Kodu
okuyunca üçüncü bir gerçek çıktı: **`@nestjs/common` hiçbir authorization sözleşmesi tanımlamıyor.**
ASP.NET'te `IAllowAnonymous` ve `IAuthorizeData` framework tipleridir; Nest'te karşılıkları yok.
`@UseGuards(X)` ne "kimlik gerekli" ne de "bu authorization" kanıtıdır — bağlı guard bir throttler,
bir feature-flag ya da bir tenant çözücü de olabilir.

Bu yüzden Nest'te:

- **T0**: `auth.anonymous` her endpoint için `"unknown"`. Bu bir gerileme değil,
  [gorunurluk.md](../../packages/spec/gorunurluk.md)'nin T0 tablosunun üçüncü satırının
  ("Hiçbiri yok → `unknown`; **Bilgi yok**") tam olarak yazıldığı vaka. Aynı vaka motokurye'de
  ASP.NET tarafında da yaşanıyor.
- **T1**: guard bağlıysa `imperative: true`, `policies: []`.
  [metadata-sozlesmesi.md](../../packages/spec/metadata-sozlesmesi.md) bunu zaten normatif olarak
  söylüyordu ("Nest'te guard'lar tanım gereği imperatiftir").
- Sonuç: beyan yoksa her Nest endpoint'i deklaratif katmanda `unknown` kalır ve **görünürlüğü T2
  probe taşır**.

Bir throttler guard'ı bu kuralla *yanlış* `imperative: true` üretir. Bedeli bir probe, doğruluk
değil: `unknown` dürüst değerdir ve probe doğru cevaplar. Belgelendi, düzeltilmedi.

## T2 probe: global interceptor kısa devresi

`SkMcpModule` koşulsuz olarak bir `APP_INTERCEPTOR` kaydeder
([probe.ts](../../sdks/nestjs/src/visibility/probe.ts)). Interceptor, istek probe sembolünü
taşımıyorsa `next.handle()` çağırır (gerçek trafikte no-op); taşıyorsa kısa devre işaretini koyup
`next`'i **hiç çağırmadan** döner.

Kesme noktasının doğru yerde olduğu Nest'in kendi kodundan doğrulandı
(`@nestjs/core/router/router-execution-context.js`): guard'lar `fnCanActivate` ile, interceptor'lar
ondan sonra, pipe'lar ve handler ise interceptor zincirinin **içindeki** thunk'ta koşuyor. Yani
interceptor tüm guard'lardan sonra, model binding ve handler'dan öncedir — ASP.NET resource
filter'ının birebir yapısal aynası.

Middleware'de yaşayan bir 401 (motokurye deseni) routing'e hiç ulaşmadığı için interceptor koşmaz
ve işaret konmaz; karar kuralı `gorunurluk.md`'de zaten "401/403 → deny, işaret olsun olmasın"
olduğu için doğru okunur.

**SDK `APP_GUARD` kaydetmez.** Kendi kesmesi interceptor olduğu için `imperative`'i her endpoint'te
kirletmez.

### Reddedilen alternatif: guard'ları DI'dan çözüp `canActivate` çağırmak

`nasil-calisiyor.md`'nin birinci yolu. Niyeti doğru, mekanizması bozuk:

1. **Middleware'i atlar, dolayısıyla değişmez 2'yi ihlal eder.** `gorunurluk.md` değişmez 2
   görünürlüğün invoke ile **aynı** kimlik kompozisyonunu kullanmasını şart koşuyor. `req.user`'ı
   middleware'de kuran bir kurulumda, elle kurulmuş bir bağlamda çağrılan guard `req.user`'ı
   `undefined` görür, 401 atar ve gerçekte yetkili bir çağıran için **yanlış `deny`** üretir. Bu,
   spec'in adıyla saydığı en kötü hata sınıfıdır.
2. Guard sırasını ve kısa devre semantiğini (global → sınıf → metot, ilk `false`/throw'da dur)
   yeniden implement etmeyi gerektirir.
3. Request-scoped guard'lar elle kurulmuş bir DI `contextId` ister — yani `RouterExecutionContext`'i
   yeniden yazmak.
4. `ExecutionContextHost` ve `GuardsContextCreator` `@nestjs/core/helpers/` altında derin
   import'lardır ve `@publicApi` değildir.

Interceptor tasarımı guard'ları **gerçekten** koşturur, hem de invoke ile aynı sentetik istek
üzerinde: aynı niyeti bozuk mekanizma olmadan sağlar.

## Bayrak: modül-özel `Symbol`'lar

`markers.ts` üç `Symbol()` tanımlar (`Symbol.for` değil, global kayıtta durmasınlar diye) ve bunları
sentetik istek nesnesine kendi kurduğu yerde koyar. Dışarıdan set edilemez: HTTP header'ları
`req.headers`'ta string anahtar olur, hiçbir tel girdisi Symbol-anahtarlı bir own-property
oluşturamaz.

Bu aynı zamanda faz-3 notlarının açık bıraktığı **M9 aynasını** kapatır: `isSkMcpRequest()` artık
Nest'te de var, host tarayıcıya özgü dönüşümlerini bu bayrakla atlayabilir.

dotnet'e göre bir sadeleşme çıktı: prober `req` nesnesinin sahibi olduğu için kısa devre işaretini
dispatch çözüldükten sonra doğrudan okur. dotnet'in işareti 204 + `HttpContext.Items` ile kodlaması
gerekiyordu.

## Kaçış kapısı: yapısal `describeVisibility()`

Yukarıdaki kurallarla bir Nest host'u **hiçbir şekilde** `anonymous: "no"` ya da dolu `policies`
üretemez; yani `metadata-sozlesmesi.md`'nin üç alanlı auth modelinin iki alanı Nest'te ölü kalırdı
ve "deklaratif yazan backend probe bedeli ödemez" vaadinin Nest karşılığı olmazdı.

Çözüm, host'un zaten yazdığı guard'a **opsiyonel bir metot**:

```ts
describeVisibility?(): { anonymous?: "yes" | "no" | "unknown"; policies?: string[] }
```

Default evaluator `typeof guard.describeVisibility === "function"` diye bakar. Bu **yapısal**
duck-typing'dir — `CanActivate`'in kendisi gibi — host tipini adıyla eşleme değil, dolayısıyla
faz-3 notlarının yönlendirici kısıtını ("hiçbir host'a özgü attribute/tip SDK'da adıyla geçmez")
ihlal etmez. Bir guard beyan ederse `imperative` o guard için kalkar; bağlı guard'lardan biri bile
beyan etmiyorsa `imperative` true kalır.

Karar 006'nın kapalı listesine **satır eklemez**: bir interface ya da DI token'ı değil, çağıranın
kendi tipine koyduğu opsiyonel bir metottur.

## Genişletme noktaları

Karar 006:37 ve :74 bu fazı önceden yetkilendirmişti. İki nokta eklendi:

| Nokta | Default | Sorumluluk |
| ----- | ------- | ---------- |
| `visibilityEvaluator` | `DeclarativeVisibilityEvaluator` | T1: bir çağıran için `CallerFacts` |
| `probeEvaluator` | `SkMcpProbeEvaluator` | T2: bir giriş için önbelleksiz verdict |

Default `visibilityEvaluator` dürüsttür: `{ identity: "unknown" }` döner, çünkü Nest'te
sorulabilecek bir framework authentication'ı yoktur. Kimliği ve policy sonuçlarını bilen host bu
noktayı ezer. `as const satisfies` kısıtı korundu; `toProviders` ve `moduleExports` token haritası
üzerinde döndüğü için değişmedi. Liste altıda kaldı.

DTO şema türetimi bir **delegate**tir (`options.schema.typeShape`), `Naming.Prefix` /
`Schema.PropertyName` ile aynı sınıf — tabloya satır eklemez.

## `visibility.tier` default'u `declarative` kalıyor

T0/T1 kör olduğu için `declarative` default'ta her tool `authUncertain` görünür. Yine de default
`probe`'a çevrilmedi: probe'un maliyeti backend'e göre değişir (motokurye'de 50 kartlık arama
21.978 ms ölçüldü, sebebi host'un her istekte açtığı NHibernate oturumu) ve bu maliyet **sessizce**
açılmamalı. Karar 003 cetveli: maliyet politikası host'undur. SDK açılışta tek satır uyarı basar,
demo `probe` kullanır (dotnet demo'su da öyle).

## Reddedilen alternatifler

- **`@nestjs/passport`'un `AuthGuard()`'ını tanımak.** Opsiyonel bir paketin tipini constructor
  kimliğiyle ya da adıyla eşlemek, faz-3'te kullanıcının geri çevirdiği
  `RequirePermissionAttribute` deseninin aynısı olurdu.
- **`SetMetadata('roles', …)`'ı okumak.** Nest'in kendi dokümanındaki rol örneği bu ama bir
  çerçeve sözleşmesi değil, host konvansiyonudur. Anahtar adı projeden projeye değişir; okumak
  SDK'yı bir konvansiyona bağlardı. Spec'in "Nest'in roles decorator'ı" varsayan üç cümlesi bu
  yüzden düzeltildi (amendment 5).
- **Guard yokluğunu `anonymous: "yes"` saymak.** Nest'te auth'un idiomatik yeri `app.use()`
  middleware'idir ve middleware endpoint metadata'sına yazmaz. Guard yokluğu hiçbir şey kanıtlamaz;
  `unknown` doğru cevaptır. Bu, `gorunurluk.md`'nin ASP.NET tarafında zaten verdiği kararın aynısı.
- **`probeEvaluator`'ı eklememek ve probe'u sealed tutmak.** Karar 006 bu noktayı adıyla
  yetkilendirmişti; ayrıca farklı bir probe stratejisi (ör. yalnız GET'leri probe etmek) meşru bir
  host politikasıdır.
