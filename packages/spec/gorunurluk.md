# Görünürlük

> Statü: **hipotez v0** — iki bağımsız doğrulaması (iki backend / iki framework) olmayan kural normatif değildir.

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

1. `auth.anonymous` false ve `callerFacts.identity` `absent` → `deny`
2. `auth.policies` içindeki herhangi bir adın sonucu `deny` → `deny`
3. `auth.imperative` true → `unknown`
4. `auth.anonymous` false ve `callerFacts.identity` `unknown` → `unknown`
5. `auth.policies` içindeki herhangi bir ad için sonuç bildirilmemiş veya `unknown` → `unknown`
6. aksi halde → `allow`

Sıra gerekçeleri:

- **1 önce:** kimlik yokluğu en ucuz ve en kesin reddir.
- **2, 3'ten önce:** policy birleşim semantiği AND'dir; kesin bir red, her belirsizlikten bağımsız olarak sonucu belirler. Aksi sıra, hakkında kesin bilgi olan endpoint'i belirsize düşürürdü.
- **3, 4 ve 5** hep `unknown` üretir; aralarındaki sıra sonucu değiştirmez, kural okunurluğu için sabitlenmiştir.
- **Sonuç bildirilmemiş policy `allow` sayılmaz** (kural 5). SDK değer uydurmaz — [karar 001](../../docs/kararlar/001-kimlik-tasiyicilari.md)'in "uydurma yok" değişmezinin görünürlük hali. Aynı ilke kimlik için kural 4'tür.

`auth.anonymous` yalnız **kimlik** hakkındadır, yetkinin tamamı hakkında değil: anonim bir endpoint'te lisans/feature kapısı gibi imperatif bir kontrol durabilir. Bu yüzden kural 1 `allow` üretmez, yalnız kural 3'e yol verir.

## Değerlendirme merdiveni

Katmanlar framework sözleşmeleri üzerinden tanımlıdır; SDK hiçbir host'a özgü tip tanımaz.

| Katman        | Ne okur                                                                                      | Üretir                    |
| ------------- | -------------------------------------------------------------------------------------------- | ------------------------- |
| T0 anonim     | Endpoint metadata'sındaki framework anonim işareti                                           | `auth.anonymous`          |
| T1 deklaratif | Framework'ün deklaratif yetki verisi → birleşik policy → değerlendirilebilir requirement'lar | `policyResults` girdileri |
| T2 probe      | Sentetik istek gerçek pipeline'a sokulur, **handler'dan önce** kesilir; status okunur        | `allow` / `deny`          |
| T3            | Yukarıdakiler karar vermediyse                                                               | `unknown`                 |

T0 framework'ün **gerçek** anonimlik kuralını okur, yalnız açık işareti değil: endpoint anonimdir eğer anonim işareti taşıyorsa **veya** hiç deklaratif yetki verisi taşımıyor ve uygulamada fallback policy yoksa. (ASP.NET'te `[Authorize]`'sız ve fallback'siz bir endpoint'i authorization middleware'i hiç değerlendirmez — anonimdir.) Auth'u tamamen custom middleware'de yaşayan backend'de bu, endpoint'lerin framework gözüyle anonim görünmesi demektir; SDK backend'in kendi kararını okur, yaptırım invoke anındaki middleware'dedir.

Roller deklaratiftir ve değerlendirilebilir: framework'ün rol gereksinimi `auth.policies`'e `roles:<ad>[,<ad>]` biçiminde ad olarak yazılır; T1 bu öneki tanıyıp rol policy'si kurar. Nest'in roles decorator'ları aynı biçime düşer.

T1'de körlemesine değerlendirme yasaktır: kaynak gerektiren bir requirement'ı kaynaksız koşmak yanlış `deny` üretebilir. Yalnız framework'ün kendi tanıdığı, kaynaktan-bağımsız requirement türleri değerlendirilir; kalanı `unknown`'dır.

T2 opt-in'dir ve maliyeti sınırlıdır: probe **sıralama sonrası** ilk K adaya uygulanır, böylece maliyet endpoint sayısıyla değil K ile büyür. Probe'un yan etkisi olamaz — kesme noktası handler'dan öncedir ve kesme katmanının o endpoint için kurulu olduğu kanıtlanmadıkça probe yapılmaz.

## T2 probe: mekanik

Probe, deklaratif katmanın `unknown` bıraktığı endpoint için framework'ün gerçek verdict'ini alır: sentetik istek (invoke ile aynı kimlik kompozisyonu) gerçek pipeline'a girer ve yetki kararı verildikten hemen sonra, handler'dan **önce** kesilir.

- **Bayrak istek bağlamındadır, header değil** (C#: `HttpContext.Items`). Dış istek probe modunu açamaz. Host, audit/rate-limit/log middleware'ini bu bayrakla atlayabilir (C#: `IsSkMcpProbe()`). Probe'a özgü olmayan atlamalar için sentetik istek işareti kullanılır (C#: `IsSkMcpRequest()`, [karar 003](../../docs/kararlar/003-istek-ustverisi.md) M9) — o işaret invoke'da da taşınır.
- **İki kesme noktası:** framework'ün authz middleware sonuç işleyicisi ve MVC resource filter'ı (tüm authorization filter'larından sonra, model binding'den önce). Sonuç işleyici **reddi** her endpoint için kaydeder; **başarıda** yalnız MVC action'ı olmayan endpoint'i (minimal API) keser — MVC action'ında `next`'e geçer ki imperatif authorization filter'ları koşsun ve verdict'i resource filter okusun. Aksi halde `[Authorize]` + imperatif filter taşıyan endpoint, filter hiç koşmadan `allow` sayılırdı. Kesilen probe başarı status'u + kesme işareti döner. Host'un kendi sonuç işleyicisi varsa değiştirilmez, sarılır.
- **Uygunluk:** endpoint routing'de bilinmeli ve (MVC action olmalı) **veya** (deklaratif yetki verisi taşımalı **ve** metodu güvenli olmalı — GET/HEAD). Güvenli olmayan metot yalnız MVC backstop'u garanti iken probe edilir; başka hiçbir koşulda handler'ın koşma riski alınmaz.
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
