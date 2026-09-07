# Görünürlük

> Statü: **normatif** — iki bağımsız implementasyonla doğrulandı (ASP.NET `VisibilityCombiner` + TS `evaluateVisibility` aynı `visibility/` korpusunu geçiyor; T0/T1/T2 iki çerçevede de uygulandı (platform farkları metinde adıyla yazılı)).

`search_tools` sonuçlarının çağıranın yetkisine göre nasıl filtrelendiğini tanımlar. Makine-okur karşılığı: [schemas/fixture.schema.json](schemas/fixture.schema.json) `visibility` fixture türü; korpus [conformance/visibility/](../conformance/visibility/).

## İki eksen, iki farklı sorumluluk

|                           | Yaptırım (`invoke_tool`)     | Görünürlük (`search_tools`)          |
| ------------------------- | ---------------------------- | ------------------------------------ |
| Nerede olur               | Backend'in gerçek pipeline'ı | SDK                                  |
| Her çağrıda doğrulanır mı | **Evet, koşulsuz**           | Hayır — best-effort                  |
| Doğru olmak zorunda mı    | Zorunlu; güvenlik burada     | Değil; yanlışsa invoke yine reddeder |
| Amacı                     | Güvenlik                     | UX + varlık sızıntısını önleme       |

Ayrıntı: [docs/nasil-calisiyor.md](../../docs/nasil-calisiyor.md).

## Karar üç değerlidir

`allow` (göster) · `deny` (gizle) · `unknown` (değerlendirilemedi).

`unknown`'ı ikiye zorlamak iki yönde de yanlış: `deny`'ye kırmak çağıranın gerçekten kullanabildiği endpoint'i görünmez yapar (yeteneği yok eder), `allow`'a kırmak belirsizliği agent'tan saklar. Üçüncü değer taşınır ve karta `authUncertain` olarak yansır.

## İyimser semantik

Gerçek yetki fonksiyonu `auth(endpoint, caller, resource, env)`. Liste anında `resource` yoktur — argüman bile yoktur. İki farklı soru sorulabilir:

- **İyimser:** çağıranın bu endpoint'i kullanabildiği _bir_ kaynak var mı?
- **Kötümser:** her kaynak için kullanabilir mi?

Görünürlük **iyimser** soruyu cevaplar. Kötümser soru "kendi kaydını görebilen" endpoint'leri gizler; bu, filtrenin amacının tersidir.

İyimser soru şu koşulda çözülebilir: yetki, **kaynaktan-bağımsız kapı** (scope, claim, role, tenant, lisans) ile **kaynağa-bağımlı incelik** (satır seviyesi, sahiplik) olarak faktörize oluyorsa. Gerçek sistemler böyle kurulur: endpoint'te kapı, handler içinde incelik.

> **Normatif:** Görünürlük yalnız yetkinin kaynaktan-bağımsız kapısını değerlendirir. Kaynağa bağımlı incelikler _sağlanabilir_ kabul edilir; karar invoke anına ertelenir.

Bunun mekanik karşılığı birebir örtüşür: kaynaktan-bağımsız kapı = handler koşmadan önce koşan her şey.

## Saf çekirdek

Değerlendirme iki parçaya ayrılır. Bu ayrım fixture'lanabilirliğin şartıdır.

**Platform tarafı (impure, SDK'ya özgü):** iki soruyu cevaplar — "çağıran kimlikli mi?" ve "policy P sağlanıyor mu?". Cevaplar `CallerFacts`'e yazılır.

- Kimlik, invoke ile **aynı** kompozisyonla kurulan sentetik istek üzerinde backend'in kendi authentication'ı koşturularak bulunur (ASP.NET: `IAuthenticationService.AuthenticateAsync`; NestJS: guard'ı sentetik bağlamda koşmak). Sonuç üç değerlidir: `present` (kimlik çözüldü), `absent` (kimlik yok veya geçersiz), `unknown` (backend'in bu yoldan sorulabilecek bir authentication'ı yok — kimlik custom middleware'de yaşıyor). SDK `unknown`'ı `absent`'e kırmaz: kırsaydı, authentication scheme'i olmayan bir backend'de kimlik gerektiren her tool gizlenirdi.
- Policy cevapları yalnız kimlik `present` iken sorulur; kimliksiz veya bilinmeyen kimlikle policy sonucu bildirilmez.

**Saf tarafı (spec'li, dil bağımsız):** `(auth, callerFacts) → decision`. Kurallar **sırayla** uygulanır, ilk eşleşen kazanır:

1. `auth.anonymous` `no` ve `callerFacts.identity` `absent` → `deny`
2. `auth.policies` içindeki herhangi bir adın sonucu `deny` → `deny`
3. `auth.imperative` true → `unknown`
4. `auth.anonymous` `unknown` → `unknown`
5. `auth.anonymous` `no` ve `callerFacts.identity` `unknown` → `unknown`
6. `auth.policies` içindeki herhangi bir ad için sonuç bildirilmemiş veya `unknown` → `unknown`
7. aksi halde → `allow`

Sıra gerekçeleri:

- **1 önce:** kimlik yokluğu en ucuz ve en kesin reddir.
- **2, 3'ten önce:** policy birleşim semantiği AND'dir; kesin bir red, her belirsizlikten bağımsız olarak sonucu belirler. Aksi sıra, hakkında kesin bilgi olan endpoint'i belirsize düşürürdü.
- **3, 4, 5 ve 6** hep `unknown` üretir; aralarındaki sıra sonucu değiştirmez, kural okunurluğu için sabitlenmiştir.
- **Sonuç bildirilmemiş policy `allow` sayılmaz** (kural 6). SDK değer uydurmaz — [karar 001](../../docs/kararlar/001-kimlik-tasiyicilari.md)'in "uydurma yok" değişmezinin görünürlük hali. Aynı ilke kimlik için kural 5, anonimlik için kural 4'tür.

`auth.anonymous` yalnız **kimlik** hakkındadır, yetkinin tamamı hakkında değil: anonim bir endpoint'te lisans/feature kapısı gibi imperatif bir kontrol durabilir. Bu yüzden `yes` tek başına `allow` üretmez, yalnız sonraki kurallara yol verir.

## Değerlendirme merdiveni

Katmanlar framework sözleşmeleri üzerinden tanımlıdır; SDK hiçbir host'a özgü tip tanımaz.

| Katman        | Ne okur                                                                                      | Üretir                        |
| ------------- | -------------------------------------------------------------------------------------------- | ----------------------------- |
| T0 anonim     | Endpoint metadata'sındaki framework anonim/yetki işaretleri                                  | `auth.anonymous` (üç değerli) |
| T1 deklaratif | Framework'ün deklaratif yetki verisi → birleşik policy → değerlendirilebilir requirement'lar | `policyResults` girdileri     |
| T2 probe      | Sentetik istek gerçek pipeline'a sokulur, **handler'dan önce** kesilir; status okunur        | `allow` / `deny`              |
| T3            | Yukarıdakiler karar vermediyse                                                               | `unknown`                     |

T0 üç değerli okur, çünkü metadata'nın söylediği ile backend'in yaptığı aynı şey değildir:

| Endpoint metadata'sı                                             | `auth.anonymous` | Gerekçe                                                      |
| ---------------------------------------------------------------- | ---------------- | ------------------------------------------------------------ |
| Anonim işareti var (`IAllowAnonymous`)                           | `yes`            | Kesin bilgi: framework bu endpoint'i kimlik aramadan geçirir |
| Deklaratif yetki verisi var, veya uygulamada fallback policy var | `no`             | Kesin bilgi: framework kimlik arar                           |
| Hiçbiri yok                                                      | `unknown`        | **Bilgi yok**                                                |

Üçüncü satır bu spec'in en kolay yanlış yazılan kuralıydı. Önceki sürüm onu `yes` sayıyordu, gerekçe olarak da framework'ün kendi davranışını gösteriyordu: ASP.NET'te `[Authorize]`'sız ve fallback'siz bir endpoint'i authorization middleware'i hiç değerlendirmez. Bu doğru ama **dar** bir gerçektir: yalnız framework'ün authorization katmanı hakkında konuşur, "bu endpoint'i hiçbir şey engellemez" demez.

Koruma pekâlâ framework'ün dışında olabilir. Middleware endpoint metadata'sına **yazmaz**, yalnız okur: `app.UseMiddleware<...>()` bir endpoint'e değil pipeline'a bağlanır, dolayısıyla "beni bu middleware koruyor" diye bir işaret yoktur. Kimliği global bir middleware'de kuran bir backend'de metadata'da yalnız negatif işaret (anonim muafiyeti) bulunur, pozitif işaret hiç bulunmaz. Ölçüm: 718 endpoint'lik gerçek bir backend'de 698 tool'un tamamı `yes` çıkıyordu; 447'si imperatif işaret taşıdığı için yine de `unknown`'a düşüyordu ama kalan 251'i `allow` görünüyor, kimliksiz çağıranın listesine giriyor ve invoke'da 401 alıyordu.

`unknown` bu bilgisizliği dürüstçe temsil eder ve kararı probe'a devreder: sentetik istek gerçek pipeline'a girer, custom middleware'in 401'i **bayrak işaretlenmeden** görülür ve `deny` olarak okunur. Yani okunamayan koruma koşturularak ölçülür. Deklaratif yazan backend hiçbir maliyet ödemez; `[Authorize]` ve `[AllowAnonymous]` yazıldığı sürece cevap statiktir.

Bilinçli sınır, **platforma göre değişir**: probe'un kesme noktası olmayan endpoint'ler `unknown` kalır ve `authUncertain` ile gösterilir. ASP.NET Core'da bu, yetki beyanı taşımayan minimal API / route handler'lardır; orada tek satırlık `[AllowAnonymous]` cevabı kesinleştirir — SDK'ya değil, framework'e yazılan bir satır. NestJS'te böyle bir endpoint sınıfı **yoktur**: keşfedilen her endpoint bir controller route'udur ve SDK'nın kesme katmanı onların hepsi için kuruludur, dolayısıyla her endpoint probe edilebilir.

Roller deklaratiftir ve değerlendirilebilir: framework'ün rol gereksinimi `auth.policies`'e `roles:<ad>[,<ad>]` biçiminde ad olarak yazılır; T1 bu öneki tanıyıp rol policy'si kurar. Bu yalnız **çerçevenin deklaratif bir rol sözleşmesi taşıdığı** platformlarda işler; taşımayan platformda (NestJS) `policies` boş kalır ve karar T2'ye devredilir ([metadata-sozlesmesi.md](metadata-sozlesmesi.md)).

T1'de körlemesine değerlendirme yasaktır: kaynak gerektiren bir requirement'ı kaynaksız koşmak yanlış `deny` üretebilir. Yalnız framework'ün kendi tanıdığı, kaynaktan-bağımsız requirement türleri değerlendirilir; kalanı `unknown`'dır.

T2 opt-in'dir ve maliyeti sınırlıdır: probe **sıralama sonrası** ilk K adaya uygulanır, böylece maliyet endpoint sayısıyla değil K ile büyür. Probe'un yan etkisi olamaz — kesme noktası handler'dan öncedir ve kesme katmanının o endpoint için kurulu olduğu kanıtlanmadıkça probe yapılmaz.

## T2 probe: mekanik

Probe, deklaratif katmanın `unknown` bıraktığı endpoint için framework'ün gerçek verdict'ini alır: sentetik istek (invoke ile aynı kimlik kompozisyonu) gerçek pipeline'a girer ve yetki kararı verildikten hemen sonra, handler'dan **önce** kesilir.

- **Maliyet politikası host'undur.** Probe'un ne kadar agresif koşacağı backend'e göre değişir: veritabanı yükü, rate limiter, kabul edilebilir arama gecikmesi her kurulumda farklıdır ([karar 003](../../docs/kararlar/003-istek-ustverisi.md) cetveli). SDK iki ayar sunar ve makul default'lar seçer: aday sayısı (`ProbeTopK`, sıralama sonrası ilk K) ve eşzamanlılık (`ProbeConcurrency`, 1 = sıralı). T2 verdict'i ayrıca çağıran başına önbelleklenir; anahtar türetimi, ad alanı, ömür/jitter ve geçersiz kılma artık ayrı bir belgede normatiftir: [onbellek.md](onbellek.md). `Identity.Project` dış istek dışında bir kaynaktan (saat, sayaç, veritabanı) değer türetiyorsa doğru kapı [onbellek.md](onbellek.md)'nin de işaret ettiği gibi `ICallerScopeResolver`'ı ezmektir, önbelleği kapatmak değil.
- **Bayrak istek bağlamındadır, header değil** (C#: `HttpContext.Items`). Dış istek probe modunu açamaz. Host, audit/rate-limit/log middleware'ini bu bayrakla atlayabilir (C#: `IsSkMcpProbe()`). Probe'a özgü olmayan atlamalar için sentetik istek işareti kullanılır (C#: `IsSkMcpRequest()`, [karar 003](../../docs/kararlar/003-istek-ustverisi.md) M9) — o işaret invoke'da da taşınır.
- **İki kesme noktası:** framework'ün authz middleware sonuç işleyicisi ve MVC resource filter'ı (tüm authorization filter'larından sonra, model binding'den önce). Sonuç işleyici **reddi** her endpoint için kaydeder; **başarıda** yalnız MVC action'ı olmayan endpoint'i (minimal API) keser — MVC action'ında `next`'e geçer ki imperatif authorization filter'ları koşsun ve verdict'i resource filter okusun. Aksi halde `[Authorize]` + imperatif filter taşıyan endpoint, filter hiç koşmadan `allow` sayılırdı. Kesilen probe başarı status'u + kesme işareti döner. Host'un kendi sonuç işleyicisi varsa değiştirilmez, sarılır.
- **Uygunluk (çerçeve-nötr):** endpoint routing'de bilinmeli **ve** SDK'nın kesme katmanının o endpoint için kurulu olduğu **kanıtlanmış** olmalı — yani endpoint'in yürütmesi, SDK'nın kesme noktası kaydettiği, tüm yetkilendirmeden sonra ve handler'dan önce koşan bir aşamadan geçmeli. Kanıt yoksa probe yalnız endpoint deklaratif yetki verisi taşıyorsa **ve** metodu güvenliyse (GET/HEAD) yapılır.

  **Garanti:** güvenli olmayan metodun handler'ı **hiçbir koşulda koşmaz**. Kanıtsız daldaki güvenli metodun handler'ı endpoint başına **en fazla bir kez** koşabilir: işaretsiz yanıt görüldüğü an probe o endpoint için kalıcı olarak kapanır (aşağıdaki "Karar"). Bu ikinci cümle bir gevşetme değil, iki implementasyonun da fiilen verdiği garantinin dürüst ifadesidir — endpoint'in yetki _beyan etmesi_ kesme katmanının pipeline'a _kurulduğunu_ kanıtlamaz.

  | Platform     | Kesme katmanı kanıtlı                              | Yedek dal kullanılır mı                             |
  | ------------ | -------------------------------------------------- | --------------------------------------------------- |
  | ASP.NET Core | MVC action'lar (global resource filter)            | Evet — `[Authorize]` + GET/HEAD taşıyan minimal API |
  | NestJS       | **her katalog girdisi** (hepsi controller route'u) | Hayır                                               |

- **Karar:** `401`/`403` → `deny` — kesme işareti olsun olmasın: bir middleware yetki katmanından önce reddettiyse handler koşmamıştır (auth'u custom middleware'de yaşayan backend'lerin yolu). Kesme işareti + başarı → `allow`. Bunların dışında kalan her yanıt (özellikle işaretsiz 2xx) → `unknown`; o endpoint için probe kalıcı olarak kapanır ve uyarı loglanır — handler koşmuş olabilir, ikinci kez denenmez. İşaretsiz `404` route eşleşmedi demektir: yer tutucu değeri host beyan eder.
- **Bütçe:** yalnız sıralama sonrası ve yalnız `unknown` kalanlara, ilk K adaya (default 25). Bütçe dışında kalanlar `unknown` politikasına göre işlenir. `total` deklaratif sayıdır; probe onu değiştirmez.
- **İstek şekli:** path parametreleri route kısıtına göre yer tutucuyla doldurulur (sayısal → `1`, guid → boş guid, bool → `true`, tarih → `2000-01-01`, diğer → `probe`); host parametre adına göre değer beyan edebilir. Query ve body gönderilmez — kesme model binding'den öncedir, hiçbir formatter koşmaz.

## `load_tool` görünürlüğe tabidir

Arama sonucunu filtreleyip şemayı herkese vermek, gizlemeyi anlamsızlaştırır: agent adı tahmin eder, `load_tool` varlığı doğrular. Bu yüzden `load_tool` da aynı kararı uygular — `deny` olan tool için cevap, var olmayan tool'un cevabıyla **aynıdır** (`unknown_tool`). `unknown` olan tool döner ve `authUncertain` taşır. `invoke_tool` değişmez 1 gereği dokunulmaz kalır: gizli tool'u çağırmak pipeline'ın işidir.

## `unknown` politikası

Default: **göster** + `authUncertain`. Gerekçe: yeteneği korumak, ve yaptırımın invoke anında garanti olması. Varlık sızıntısına duyarlı kurulumlar `Hide`'a çevirebilir — politika kod yazanın ([karar 003](../../docs/kararlar/003-istek-ustverisi.md) cetveli).

## Değişmezler

1. **Invoke asla görünürlük filtresine bakmaz.** Bakarsa iki doğruluk kaynağı oluşur ve zamanla ayrışırlar. Agent gizli bir tool'un adını tahmin edip çağırsa da pipeline durdurur.
2. **Görünürlük, invoke ile birebir aynı kimlik kompozisyonunu kullanır** (aynı carrier listesi, aynı projector — [karar 001](../../docs/kararlar/001-kimlik-tasiyicilari.md)). Ayrışırsa filtre ve yaptırım çelişir; bu, kullanıcının gördüğü en kafa karıştırıcı hata sınıfıdır.
3. **Policy adları agent'a sızmaz.** `auth` iç modeldir; MCP yüzeyine yalnız `authUncertain` çıkar.
4. **Gizlemek gerekçe bildirmez.** Filtrelenen endpoint sonuçtan çıkarılır; "yetkiniz yok" demek varlığı ifşa eder.
5. Görünürlük **güvenlik mekanizması değildir.** Bu döküman bir yetki modeli tanımlamaz; backend'in kendi kararlarını okur.
