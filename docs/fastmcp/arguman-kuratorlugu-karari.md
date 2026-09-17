# Argüman Küratörlüğü

**Durum:** kabul edildi — uygulama bu kararı takip eder
**Tarih:** 17 Eylül 2026
**Kapsam:** `packages/spec`, `packages/core`, `sdks/dotnet`, `sdks/nestjs` — HTTP katalog ürün hattı
**Kaynak tartışma:** [fastmcp-karsilastirma.md](fastmcp-karsilastirma.md) §4.4

---

## 1. Karar

Bir host, backend'inin DTO'suna dokunmadan bir endpoint'in **argüman yüzünü** beyan edebilir:

- bir argümanı **yeniden adlandırabilir** — ajan `page_number` görür, tele `page` gider;
- bir argümanı **yeniden açıklayabilir** — şemanın kendi açıklaması ezilir;
- bir argümanı **gizleyebilir** ve yerine sabit bir değer, çağırandan türetilen bir değer koyabilir ya da hiçbir şey göndermeyebilir.

İkinci fazda tek bir backend operasyonu birden çok tool üretebilir (**varyant**); her varyant kendi adını, açıklamasını ve küratörlüğünü beyan eder.

## 2. Neden

sk-mcp bugün tool seviyesinde ad ve açıklama verir, argüman seviyesinde hiçbir şey vermez. Beş üyeli bir query DTO'su ajana beş argüman olarak çıkar: `tenantId`'yi ajan bilmez ve uydurur, `fq`'nun Solr sözdizimi olduğunu anlamaz, `includeDeleted`'a dokunmaması gerektiğini bilmez. Tek çare DTO'yu değiştirmektir ve o REST istemcilerini kırar.

Bu, "auto-converted MCP server kötüdür" eleştirisinin bize birebir uyduğu yerdir. Cevap, ajan yüzünü backend sözleşmesinden ayırmaktır: geliştirici endpoint'e dokunmadan küratörlük yapabilmeli. Aksi hâlde sk-mcp "API'ni olduğu gibi yansıtır" seviyesinde kalır.

Talep ölçülmüş olarak da var: `metadata-extraction` korpusunun Nest'te üretilemeyen dört fixture'ından üçünün tek sebebi, Nest'te parametre açıklaması için metadata kaynağı bulunmamasıdır. Küratörlüğün `description`'ı o kaynağı yaratır.

## 3. Cetvel

Karar 003'ün ölçüsü: doğru cevap backend'den backend'e değişiyorsa **politika** → kod yazanın; tek doğru cevap varsa **mekanik** → SDK'nın, düğmesiz. Bu iş şöyle bölünür:

| Konu                                                       | Tür                                   | Nerede                                                    |
| ---------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| Hangi argüman gizlenir, neye yeniden adlandırılır          | Politika, **beyan listesi** biçiminde | Decorator/attribute + `options.arguments`                 |
| Gizli bir değerin çağırandan nasıl türetildiği             | Politika, **kod** biçiminde           | Adlandırılmış değer üreticisi (`Identity.Project` ailesi) |
| Küratörlüğün `inputSchema`'ya ve şablona nasıl uygulandığı | Mekanik                               | `packages/core` + fixture, düğmesiz                       |
| Doldurulmuş değerin kodlanması, tip kapısı, hata kodları   | Mekanik                               | Aynı                                                      |
| Şekil seçimi (kök modu, düzleştirme, çakışma)              | Mekanik ve **küratörlükten bağımsız** | Değişmez                                                  |

Karar 006'nın genişletme noktası listesi kapalıdır ve bu iş onu **genişletmez**: yeni bir `TryAdd` arayüzü yoktur, yalnız `Naming`/`Schema` gibi bir options grubu ve onun içinde bir delegate vardır.

Karar 006'nın sealed listesi de korunur. `ToolDefinitionFactory`, `RequestComposer`, `ToolNameFactory` ezilemez; küratörlük onlara hook eklemez, yeni bir **girdi** verir. Precedent karar 014 amendment #1: çözülmüş ad `createToolDefinition(endpoint, name?)` ile girdi hâline getirilmişti.

## 4. Dört yapısal taahhüt

**4.1 Beyan saf veridir.** `EndpointDescriptor.toolName` ve `containerPrefix` zaten keşfedilmiş olgu değil beyandır; platform onları hiyerarşik attribute'lardan toplar ve saf katmana indirger. Küratörlük aynı yoldan girer: yeni bir `arguments` alanı. Çağırandan türetilen değer saf olamadığı için descriptor yalnız **değerin nereden geleceğini** taşır; değer invoke anında çözülür ve saf JSON olarak `compose`'a verilir. Fixture precedent'i mevcut — `naming` korpusu `hostPrefixes` haritasını taşıyor ve runner ondan delegate'i kuruyor.

**4.2 Küratörlük şekil seçimini etkilemez.** Kök modu kararı, düzleştirme ve teklik denetimi **tel adları üzerinde ve küratörlükten önce** çalışır. Küratörlük, kararı verilmiş bir şeklin üzerine bindirilen bir izdüşümdür.

Tasarım sırasında tersi savunuldu ve düzeltildi. Gerekçe `schema-conversion-rules.md`'nin "host `propertyName` ile yeniden adlandırdıysa yeniden adlandırılmış biçim karşılaştırılır" cümlesiydi; analoji yanlıştır. `propertyName` bir **serileştirme** adıdır, teli değiştirir. Küratörlük teli değiştirmez. Kök moduna düşüren çakışma tel seviyesinde bir belirsizliktir ve ajan tarafındaki bir yeniden adlandırma onu çözmez. Ayrıca kök modu kararı iki yerden bağımsız çağrılıyor; küratörlüğe bağlamak sapma yüzeyini iki katına çıkarırdı. Çakışmayı gerçekten düzeltmek isteyen host `Schema.PropertyName` düğmesini kullanır — tel seviyesi sorunun tel seviyesi aracı.

**4.3 Tek çözümleyici, iki tüketici.** Tool tanımı ve istek şablonu descriptor'u bugün birbirinden bağımsız okuyor. Küratörlüğü ikisi ayrı yorumlarsa tool'un özellikleri ile şablonun izin listesi ayrışır ve sapma **görünmez** olur: tool kurulur, çağrı patlar. Saf bir `resolveCuration` ikisi tarafından da çağrılır ve küratörlük hatalarını yükselten tek yerdir.

**4.4 Küratörlük lookup'ı değiştirir, emisyonu değiştirmez.** Yeniden adlandırma yalnız ajanın gönderdiği anahtarı değiştirir. URL'e yazılan query anahtarı, header adı ve route placeholder tel adıdır ve hiç değişmez. `ParameterBinding.name`'in anlamı tel olarak kalır; mevcut `argument-mapping` korpusunun tamamı onu böyle okuyor.

## 5. Değişmezler

1. **Küratörlük enforcement değildir.** `tenantId`'yi gizleyip token'dan doldurmak tenant izolasyonu sağlamaz; backend'in kendi yetkilendirmesi karar verir. Görünürlüğün aynı değişmezinden **daha çok** yazılmayı hak eder: görünürlük bariz biçimde yalnız bir listeyi süzer, küratörlük bariz biçimde tele bir değer yazar.
2. **Küratörlük gizlilik sınırı değil, ergonomi özelliğidir.** Gizlenen bir path parametresinin adı route'ta kalır ve arama indeksi route'u indeksler; sızan sözlüktür, değer değil. Bu fark yazılmazsa yanlış güvenlik varsayımı kurulur.
3. **Gizli argüman ajan tarafından set edilemez.** Ne ajan adı ne tel adı izin listesindedir; ikisi de aynı `unknown_argument` cevabını alır, böylece gizli alanın varlığı sızmaz. Kural serbest biçimli gövdelerde de geçerlidir — reddetme, "ek anahtarlara izin var" iznini yener.
4. **Küratörlenmiş yüzey tek yüzeydir.** Kart, `load_tool` ve hata alan adları küratörlenmiş adları konuşur.
5. **Küratörlük genişletmez.** Backend'in kabul etmediği bir argüman eklenemez, argümanın şeması değiştirilemez.
6. **Kimlik hâlâ argüman değildir.** Gizli bir bağ kimlik taşıyıcısı header'ını hedefleyemez ve bir değer üreticisi kimlik kanalına yazamaz; o iş `Identity.Project`'in.
7. **Çağırana göre küratörlük yoktur.** Tool şeması çağırana bağlı olursa katalog snapshot'ı, kuşak damgası ve `listChanged` fan-out'u anlamını yitirir — üçü de tek bir global kuşağı varsayıyor. Çağırana göre değişen tek şey ertelenmiş bir doldurmanın değeridir.

## 6. Yüzey

Beyan iki yerden yazılır: endpoint'in yanında (decorator/attribute) ve merkezi options'ta. İkisi gerekli — merkezi olmadan dokunulamayan bir controller küratörlenemez ve kırk endpoint'te tekrar eden bir tenancy kuralı kırk kez yazılır; yanında olmadan beyan koddan ayrı düşer ve sapar.

Birleşme en özel kazanır: hedefsiz merkezi kural < konteyner < controller+action ya da metot < varyant. Birleşme argüman ve alan bazındadır; farklı seviyeler ezme, aynı seviyedeki çelişki fatal hatadır. Merkezi kural ile decorator aynı seviyeye düşerse decorator kazanır. Politika-şekilli bir kuralın decorator tarafından yenilmesini engellemek için `seal` vardır; mühürlü bir alanı ezmeye çalışmak fatal'dır.

Gizleme üç biçimlidir: sabit, ertelenmiş (adlandırılmış üreticiden) ve **atlama**. Atlama olmadan "ajan görmesin ama backend'in kendi varsayılanı geçerli olsun" ifade edilemez; sabit yazmak varsayılanı ezer ve Tablo 5'in `default` yazmama gerekçesine ters düşer. Zorunlu bir argüman atlanamaz.

Değer üreticisinin gördüğü çağıran ham header'ları ve doğrulanmış token'ı taşır. Nest'te kaynak MCP SDK'nın `authInfo`'sudur — bugün üretilip sınırda atılıyor; C#'ta `HttpContext.User`'dır. İki platform simetrik değildir ve asimetri örtülmez: C#'ta scope kavramı claim ayrıştırmasına dayanır ve boş küme "bilinmiyor" demektir; Nest'te claim değerleri yalnız dize oldukları ölçüde okunur; C#'ta hangi principal'ın kullanıldığı yazılır.

## 7. Conformance köprüsü

Yeni fixture türü **eklenmez**. Dört mevcut türün girdi şekli genişler ve mevcut korpus değişmeden geçer, çünkü eklenen alanların hepsi opsiyoneldir. Yeni bir tür yedi yerde değişiklik isterdi; bu tasarım o maliyeti ödemiyor.

Ertelenmiş doldurma fixture'la pinlenir: fixture çözülmüş değerleri kaynak adına anahtarlı bir harita olarak taşır ve runner delegate'i ondan kurar — `hostPrefixes` deseninin aynısı. Sabitler şablonda yaşadığı için host delegate'i olmayan bir fixture bile sabit davranışını pinler.

En kritik iki fixture güvenlik-şekillidir: serbest biçimli bir gövdede gizlenmiş bir alanın tel adının reddedilmesi, ve yeniden adlandırılmış bir gövde alanının eski adının reddedilmesi. İkisi de sessizce çalışsaydı gizleme atlatılabilir olurdu.

## 8. Varyantlar

Bir operasyonun kimliği değişmez. Varyantlar operasyon üretmez, **tool** üretir; benzersizliği `name_collision` zaten uyguluyor. Genişleme route katlamasından kesinlikle sonra yapılır, böylece katlama mantığı hiç değişmez.

Varyant beyan eden bir metot yalnız varyantlarını üretir, ayrıca küratörlenmemiş bir taban tool üretmez — aksi hâlde host'un az önce gizlediği argümanı üçüncü bir tool geri açar. Her varyant kendi adını ve açıklamasını yazmak zorundadır; bu kural hem tip sisteminde hem başlangıç doğrulamasında durur.

Zorunluluğun gerekçesi açıklamanın yalan söylemesidir. Endpoint'e yazılmış tek bir açıklama, argümanları farklı gizlenmiş iki tool'u aynı anda doğru anlatamaz. Aynı risk tek tool'da da var: `tenantId` gizlenince "filter by tenant" cümlesi ajana ulaşamayacağı bir argümanı anlatır. Bunun için bir açıklama-lint'i çalışır — tool **adı** ya da açıklaması gizlenmiş veya yeniden adlandırılmış bir tel adını bitişik token dizisi olarak geçiriyorsa uyarı üretilir. Ad kontrolü şarttır: route'tan üretilen ad `by_<path parametresi>` içerir, yani bir path parametresini gizlemek adı ortada bırakır. Lint sezgiseldir, uyarı seviyesindedir ve varsayılan olarak fatal'a yükseltilmez.

Varyantlar `auth`'u paylaşır, dolayısıyla aynı görünürlük kararını alır: dar bir varyant dar bir izin değildir. Ve arama indeksini seyreltirler — aynı route, yakın açıklamalar, aynı anahtar kelimeler için yarışan kartlar. Kart 160 karakterde kesildiği için varyant açıklamaları ilk cümlede ayrışmalıdır.

## 9. Bilinçli eklenmeyen

- **Şema daraltma.** Bir argümanın şemasını daraltmak (`string` → `enum`) güçlü ama denetlenemez: "daraltma mı genişletme mi" mekanik olarak ölçülemez ve yanlış beyan, backend'in kabul ettiğinden dar bir sözleşme yayınlayıp ajanın geçerli bir çağrı kurmasını engeller.
- **Görünür varsayılan.** Tablo 5 `default` yazmamayı bilinçli seçti; gizleme tek değer enjeksiyon yoludur ve atlama "varsayılanı backend'e bırak" ihtiyacını karşılar.
- **Genel bir tool dönüştürme hook'u.** Karar 003 ve 006 genel `Customize` hook'unu iki kez reddetti. Adlandırılmış, tek amaçlı beyan kalır.
- **Argüman yeniden sıralama.** Özellik ve zorunluluk sırası normatiftir; küratörlük yerinde yeniden adlandırır, sıra değiştirmez.
- **Açıklamayı silme.** Açıklama en az bir karakterdir; boş dize, JSON fixture'da "beyan yok"tan ayırt edilemez.
- **Değeri başka bir argümandan türetme.** Bugün yapılmaz ama üretici imzası onu dışlamaz: üretici ajanın doğrulanmış argümanlarını da görür, böylece bu durum ileride yeni bir mekanizma değil aynı mekanizmanın sonraki kullanımı olur.
