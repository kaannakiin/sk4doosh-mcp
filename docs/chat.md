# AI Chat · MCP · OAuth

## Kavramsal Mimari ve Geliştirme Yol Haritası

**Sürüm:** 0.1 — tartışma ve karar dokümanı  
**Tarih:** 12 Eylül 2026  
**Başlangıç noktası:** Decorator ve JSON Schema tabanlı mevcut SDK  
**Durum:** Teknoloji sağlayıcıları ve nihai stack henüz seçilmedi.

> **Ana fikir:** Firma kendi iş mantığını korur. SDK, seçilmiş işlemleri tanımlı araçlara dönüştürür. AI işlem önerir; platform yetkiyi ve gerekli onayı denetler; firma işlemi kendi sisteminde gerçekleştirir.

### Bu doküman nasıl kullanılmalı?

Bu metin, projeyi sıfırdan başka bir ürüne dönüştürmek için değil, mevcut SDK başlangıcının etrafındaki eksik mimari kararları görünür kılmak için hazırlanmıştır. Kod incelemesi değildir. “Mevcut” olarak belirtilen özellikler senin anlattıklarına; “öneri” olarak belirtilenler burada geliştirilen tasarıma dayanır.

Bölüm numaraları sonraki konuşmalarda referans vermek içindir. Örneğin “04’teki recursive şemayı konuşalım” veya “07’de kendi OAuth modelimi seçiyorum” diyebiliriz. İlk okuma için 01–08; güvenli çalıştırma için 09–12; geliştirme sırası ve kararlar için 13–16 bölümlerini kullan.

### Okuma haritası

| Bölümler | Ana soru                                                      |
| -------- | ------------------------------------------------------------- |
| 01–02    | Ne geliştiriyoruz, hangi parça ne yapıyor?                    |
| 03–05    | Mevcut SDK nasıl bir araç sözleşmesine dönüşüyor?             |
| 06–08    | Firma ve kullanıcı nasıl bağlanıyor, OAuth nerede duruyor?    |
| 09–12    | AI neyi yapabiliyor, işlemler nasıl güvenli yürütülüyor?      |
| 13–16    | Firma entegrasyonu, geliştirme sırası ve açık kararlar neler? |
| 17–18    | Terimler ve resmî kaynaklar                                   |

Kaynak numaraları teknik standartları işaret eder. Bunun dışındaki mimari tercih ve örnek akışlar bu proje için öneridir. Banka senaryoları gerçek banka entegrasyonu veya mevzuat uygunluğu iddiası değil, tasarımı sınamak için kullanılan örneklerdir.

<!-- PAGE -->

# 01 · Ürün hedefi ve mevcut başlangıç

### 01.1 Geliştirdiğimiz ürün

Kullanıcının doğal dille iş yaptırabildiği bir chat uygulaması geliştiriyoruz. Firmalar platforma kendi işlem yeteneklerini ekliyor. Kullanıcı ilgili firmadaki hesabını bağlayıp izin veriyor. AI, isteği uygun araca dönüştürüyor; platform kontrol ettikten sonra işlem firmanın sisteminde çalışıyor.

**Platformun işi bankanın, mağazanın veya başka bir firmanın backend’ini yeniden yazmak değil; seçilmiş işlevleri kontrollü biçimde kullanılabilir hâle getirmek.** Bir firma “siparişlerimi getir”, diğeri “ödeme taslağı oluştur” yeteneği sunabilir. Hepsinin aynı veritabanını veya framework’ü kullanması gerekmiyor.

### 01.2 Mevcut kabul ettiğimiz SDK özellikleri

Senin anlatımına göre decorator tabanlı bir SDK başlangıcın var. NestJS/Swagger yaklaşımına benzer şekilde request body yapılarını alıyor, bunları AI’ın kullanabileceği tanımlara çeviriyorsun. JSON Schema kullanıyorsun; iç içe ve recursive response yapılarını referanslarla temsil ediyorsun.

Bu nedenle burada **şema çıkarma mekanizmasını yeniden icat etmiyoruz**. Onu temel kabul edip çevresine araç seçimi, güvenilir kullanıcı bağlamı, yetki denetimi, MCP çalıştırma ve sürümleme sorumlulukları ekliyoruz.

### 01.3 Henüz bilmediğimiz şeyler

Kodları görmediğimiz için SDK’nın şu anda gerçek MCP sunucusu açıp açmadığını, runtime doğrulama yapıp yapmadığını, response filtrelediğini veya NestJS güvenlik zincirini koruduğunu söyleyemeyiz. Bunlar eksik ilan edilmiş özellikler değil, doğrulanacak başlıklardır.

Aynı şekilde örnek olarak NestJS vermen, bütün platformun NestJS olacağı anlamına gelmez. Mevcut adapter bu ekosistemde kalabilir; ortak sözleşmenin framework bağımsız olması önerilir.

### 01.4 Bu sürümde bilinçli olarak seçmediklerimiz

Veritabanı ürünü, model sağlayıcısı, OAuth altyapısı, bulut, kuyruk ve dağıtım teknolojisi açık bırakılmıştır. Önce sorumlulukları netleştireceğiz. Mikroservis, herkese açık marketplace, firma kodunu kendi altyapımızda barındırma ve gözetimsiz gerçek para hareketi ilk sürümün zorunlu parçaları değildir.

> **Başarı ölçütü:** Bir firma SDK ile sınırlı yetenek sunabilmeli; bir kullanıcı yalnızca kendi yetkisiyle bunları kullanabilmeli; her çalıştırmanın neye dayanarak yapıldığı açıklanabilmeli.

<!-- PAGE -->

# 02 · Büyük resim: sorumluluklar

### 02.1 Önerilen işlem yolu

```text
Kullanıcı → Chat arayüzü → AI orkestrasyonu
                              ↓ araç çağrısı önerisi
                    Yetki ve çalıştırma katmanı
                              ↓ MCP istemcisi
                    Firmanın MCP / SDK katmanı
                              ↓
                    Firmanın mevcut iş mantığı
```

Buradaki “gateway”, bütün araç çağrılarının kontrol edildiği mantıksal geçittir. İlk sürümde ayrı bir sunucu olmak zorunda değildir. Platform backend’inin bir modülü olabilir.

| Parça                     | Temel sorumluluk                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Chat ve AI orkestrasyonu  | İsteği anlamak, eksik bilgiyi sormak, uygun araç çağrısını önermek.                    |
| Araç kataloğu             | Firma, araç tanımı, onaylanmış sürüm ve kullanılabilirlik bilgisini tutmak.            |
| Bağlantı ve yetkilendirme | Kullanıcı–firma bağlantısını, verilen izinleri ve token yaşam döngüsünü yönetmek.      |
| Çalıştırma katmanı        | Girdiyi doğrulamak, politikayı uygulamak, onayı kontrol etmek ve MCP çağrısını yapmak. |
| Firma SDK’sı              | Gelen çağrıyı doğrulayıp güvenilir bağlamla firmanın işlemine bağlamak.                |
| İşlem ve denetim kaydı    | Onay, deneme, sağlayıcı sonucu ve belirsiz durumları izlemek.                          |

### 02.2 AI ile MCP istemcisi aynı şey değil

MCP’de araçlar keşfedilip çağrılabilir; ancak uygulamamızda protokol konuşan taraf backend içindeki MCP istemcisidir. Model araç adı ve argüman önerir. Ağ bağlantısını açan, token ekleyen ve çağrıyı yürüten uygulama kodudur. Araç keşfi ve çağrı mekanizmaları standartta tanımlıdır. [S01]

Bu ayrım sayesinde modelin eline OAuth tokenı, keyfi endpoint veya HTTP istemcisi vermeden iş yaptırabiliriz. Bunun gerçekten sağlanması, modele sunduğumuz araçların ve backend’in uygulanışına bağlıdır.

### 02.3 Dağıtım önerisi

İlk sürüm için **tek, modüler platform backend’i + firmanın kendi ortamında çalışan SDK/MCP endpoint’i** öneriyorum. Firma kendi backend’ini işletir. Sen katalog, bağlantı, politika ve çalıştırmayı işletirsin.

Gateway’in ayrıca dış dünyaya bir MCP sunucusu olarak açılması zorunlu değildir. Başka chat uygulamalarına da hizmet verme hedefi oluşursa bu ayrı bir arayüz ve ayrı bir yetkilendirme sınırı olarak eklenir.

<!-- PAGE -->

# 03 · SDK’nın rolü: tanım ve çalıştırma

### 03.1 Decorator neyi ifade etmeli?

Decorator, “bu metot mevcut” bilgisinden fazlasını taşımalı: **“Bu işlem, şu amaç ve sınırlar içinde AI tarafından çağrılabilir.”** Önerilen varsayılan, hiçbir işlemin otomatik açılmamasıdır. Firma açıkça işaretlediği yetenekleri yayınlar; bütün controller’ları topluca dışarı açmayız.

Swagger benzeri çıkarım geliştirici yükünü azaltır. Ancak request body’den “bu işlem para hareketi yaratır”, “yalnızca kendi kaydını değiştirebilir” veya “kullanıcı onayı gerekir” sonucunu güvenilir biçimde çıkaramayız. İşin anlamı ve riski firma tarafından belirtilmeli; platform tarafından da değerlendirilmeli.

### 03.2 Üç aşamalı SDK önerisi

**Tanımı çıkar:** Decorator ve DTO bilgilerinden girdi, çıktı, açıklama ve işaretlenmiş metadata elde edilir. Body dışındaki gerekli path/query değerleri de tanımlanır. Token, oturum ve güvenilir kimlik alanları model girdisi yapılmaz.

**Ortak sözleşmeye dönüştür:** Framework’e özel bilgilerden bağımsız, sürümlenebilir bir araç tanımı üretilir. NestJS adapter’ı bunun bir üreticisidir. İleride farklı framework adapter’ları aynı sözleşmeyi üretebilir.

**Çalıştır:** MCP isteği, doğrulanmış kimlik ve yetki bağlamıyla ilgili işleme bağlanır. Girdi doğrulanır; işlem yürütülür; dışarı verilecek sonuç seçilir ve doğrulanır. Bu aşama, şema üretiminden ayrı test edilir.

### 03.3 Otomatik çıkarımın sınırı

NestJS dokümanı, TypeScript generics ve interface bilgilerinin runtime’da yeterince bulunmayabileceğini; circular bağımlılıklarda ek tip tanımı gerekebileceğini belirtir. Bu nedenle SDK “her tipi kendiliğinden eksiksiz çıkarırım” iddiası yerine açık tanım veya düzeltme imkânı sunmalı. Belirsiz bir alanı sessizce sınırsız kabul etmek yerine yayınlama hatası üretmek önerilir. [S02]

### 03.4 Mevcut güvenlik zincirini koru

NestJS guard’ları framework’ün request yaşam döngüsünde görev yapar. Bir controller metodunu başka bir yerden normal fonksiyon gibi çağırmak, aynı guard zincirinin çalıştığını varsaymak için yeterli değildir. [S03]

Bu projede önerim, REST ve MCP girişlerinin aynı yetkilendirilmiş iş servisine ulaşmasıdır. SDK controller yönünü kullanacaksa guard, doğrulama, tenant seçimi ve transaction davranışının nasıl korunduğu ayrıca kanıtlanmalı. **“Fonksiyon çalıştı” ile “güvenli istek akışı korundu” aynı kabul testi değildir.**

<!-- PAGE -->

# 04 · JSON Schema, recursive yapılar ve model

### 04.1 Mevcut referans yaklaşımını koruyoruz

Bir kategori alt kategoriler içerebilir; alt kategori de aynı kategori tipindedir. JSON Schema bu tür tekrar eden yapıları `$ref` ile ifade edebilir. Ortak tanımlar `$defs` altında toplanabilir. Senin iç içe response’ları referanslarla temsil etmen, bu yönde bir başlangıçtır; kodunu görmeden referansların doğruluğunu değerlendiremeyiz. [S04]

**Şemanın recursive olması ile gerçek JSON verisinin döngüsel olması farklıdır.** Ağaç biçimindeki sonlu sonuç JSON olarak taşınabilir. Bellekte kendisine geri işaret eden nesneyi ise sonsuza kadar açmayız; ilişki kimliği veya sınırlı bir gösterimle temsil ederiz. SDK için bu ayrımı açık bir test başlığı yapalım.

### 04.2 Tek doğruluk kaynağı, kontrollü gösterimler

Önerilen temel, platformun koruduğu **ana araç sözleşmesidir**. MCP tanımı ve modele sunulan araç görünümü bu sözleşmeden üretilir. Model entegrasyonunun desteklediği şema özelliklerini ayrıca test ederiz; “geçerli JSON Schema” ile “seçtiğimiz model arayüzünde sorunsuz çalışıyor” eşit kabul edilmez.

Desteklenmeyen bir özellik varsa adapter ya anlamı koruyan açık bir dönüşüm yapar ya da o araç/model birleşimini reddeder. Recursive şemayı sonsuza kadar açmak veya önemli doğrulama kurallarını sessizce silmek çözüm değildir. Model daha sade bir tanım görse bile çalıştırmadan önce ana sözleşmeye göre doğrulama yapılır.

### 04.3 Sözleşme kuralları önerisi

Şema dialect’i açıkça sabitlensin. Aynı tip tekilleştirilsin; bütün referansların çözüldüğü yayınlama aşamasında denetlensin. Dış referanslar ilk sürümde paket içine alınsın; runtime’da keyfi URL’den şema çekilmesin. Şema boyutu, doğrulama süresi, yanıt büyüklüğü ve iç içe veri derinliği için sınırlar belirlensin. Zorunlu/opsiyonel/null alanlar ayrı tanımlansın; para miktarı para birimiyle birlikte, kesin ondalık veya alt birim sözleşmesiyle taşınsın.

OpenAPI’den yararlanıyorsak kaynak sürümünü bilmeliyiz. OpenAPI 3.1’in şema temeli JSON Schema 2020-12’dir; bu, bütün eski Swagger çıktılarının dönüşümsüz eşdeğer olduğu anlamına gelmez. Girdi/çıktı yönü ve özel alanların anlamı dönüşüm sırasında korunmalıdır. [S05]

### 04.4 Response şeması ayrı, modele verilecek veri ayrı

MCP’de `outputSchema`, sunucunun yapılandırılmış sonucunu tarif eder; modelin şemaya bağlı metin üretimiyle aynı şey değildir. Tanımlanmış çıktı şemasına uygun yapılandırılmış sonuç döndürülmelidir. [S01]

Önerim, firmanın ham iç DTO’sunu doğrudan açmak yerine **AI için dış çıktı sözleşmesi** üretmesidir. Gizli alanlar firma sınırında çıkarılır; gateway ilave filtre uygular. Sonuç kısaltılıyorsa bu durum ve devam bilgisi açıkça belirtilir. Şema doğrulaması doğruluğu veya işlem başarısını tek başına kanıtlamaz.

<!-- PAGE -->

# 05 · Araç sözleşmesi ve platform manifesti

### 05.1 Araç bir endpoint kopyası olmak zorunda değil

Bir REST endpoint’iyle bir AI aracının birebir eşleşmesi şart değil. Firma aynı iş mantığını daha dar ve anlaşılır bir yetenek olarak sunabilir. Örneğin genel bir “her türlü kayıt güncelle” işlemi yerine “sipariş teslimat adresini değiştir” aracı önerilir.

Bu sözleşme ortak alan adlarını belirler; bütün sektörlerin iş modelini aynılaştırmaz. Banka hesabıyla uçuş rezervasyonunun farklı girdileri olabilir. Ortak olan, girdinin, çıktının, erişim şartlarının ve çalışma davranışının nasıl tarif edildiğidir.

### 05.2 İki ayrı bilgi grubu

| MCP’nin standart araç tanımında              | Platformumuzun ek sözleşmesinde                             |
| -------------------------------------------- | ----------------------------------------------------------- |
| Araç adı ve açıklaması                       | Sağlayıcı kimliği ve onaylanmış sözleşme sürümü             |
| `inputSchema` ve isteğe bağlı `outputSchema` | Gerekli izinler ve hesap kapsamı                            |
| Davranış hakkında `annotations`              | Risk sınıfı ve zorunlu kullanıcı onayı                      |
| Standart araç çağrısı ve sonuç yapısı        | Tekrar deneme, işlem takibi ve veri sınıflandırma kuralları |

MCP alanları standarttan gelir. Sağ sütun ise **önerdiğimiz ürün sözleşmesidir; kendiliğinden var olan MCP güvenlik garantileri değildir**. Standart ayrıca araç annotation’larının güvenilir olmayan sunuculardan geldiğinde güvenilmeyen bilgi sayılmasını ister. [S01]

Örneğin bir firmanın “bu araç sadece okur” demesi, gateway’in bütün korumaları kaldırmasına yeterli olmamalı. Platform yayın incelemesi ve kendi politikasıyla daha sıkı bir sınıflandırma uygulayabilir.

### 05.3 Kavramsal örnek

`payments_prepare` adlı araç, para göndermek yerine kullanıcıya sunulacak bir ödeme taslağı oluşturur. Tanımında ne yaptığı kadar **ne yapmadığı** da yer alır. Çıktısı taslak kimliği, doğrulanmış alıcı bilgisi, tutar, para birimi, varsa ücret ve geçerlilik süresidir. Bu adlar ve davranışlar örnek partner sözleşmesidir; bütün bankaların hazır sunduğu bir API varsayımı değildir.

### 05.4 Yayınlanan tanım yönetilmelidir

Firma kimliği, araç adı ve sürüm birlikte takip edilir. İki firmanın aynı araç adını kullanması kimlik çakışmasına yol açmamalı. Araç tanımı veya davranışı değişirse yeni sürüm incelenir. Yetki genişlemesi sessizce bütün kullanıcılara uygulanmaz.

Çalıştırma, yalnızca onaylanmış tanıma karşı yapılır. Canlı MCP kataloğuyla kayıtlı sözleşme uyuşmazsa özellikle yazma işlemlerini durdurup uyumluluk kontrolü yapmayı öneriyorum.

<!-- PAGE -->

# 06 · OAuth: birbirinden ayrı dört ilişki

### 06.1 Kullanıcının chat uygulamasına girişi

“Kullanıcı benim uygulamamda kim?” sorusu kimlik doğrulamadır. OAuth ise esas olarak kaynaklara erişim yetkisini devretme çerçevesidir. OAuth tabanlı oturum açma gerektiğinde OpenID Connect gibi kimlik katmanı kullanılır. Uygulamaya giriş yapmak, başka firmadaki hesaba erişim izni vermez. [S06] [S07]

### 06.2 Firmanın platforma kaydolması

Firma yöneticisinin geliştirici paneline girmesi; kuruluşunu, endpoint’ini ve araçlarını kaydetmesi bir **partner yönetimi** işlemidir. OAuth/OIDC ile giriş yapılabilir; ama bu giriş, müşterilerin banka veya mağaza hesaplarını platforma bağlamış olmaz.

CLI’ın manifest yayınlama yetkisi de buradadır. Bir geliştiricinin entegrasyon yayınlama anahtarının kullanıcıların adına ödeme yapma yetkisi olmamalıdır.

### 06.3 Kullanıcının firma hesabını bağlaması

“Kaan, X firmasındaki hesabı üzerinde platforma hangi işlemler için izin verdi?” sorusu kullanıcı bağlantısıdır. Bu ilişki kullanıcı, firma, yerel hesap eşlemesi ve verilen izinlerle kaydedilir.

Bir firmayı kataloğa eklemek bütün müşterilerini bağlamaz. Her kullanıcının erişimi ayrı değerlendirilir. İleride kurumsal toplu yetkilendirme eklenirse bunun yöneticisi, kapsamı ve dayandığı haklar ayrıca modellenir.

### 06.4 Platformun firma endpoint’ine istek yapması

HTTP üzerinden korunan MCP sunucusu OAuth **resource server**, ona istek yapan MCP istemcisi OAuth **client** rolündedir. Tokenı veren **authorization server**, firma tarafından işletilebilir veya firmanın güvendiği başka bir kuruluş olabilir. [S08]

Bizim örneğimizde istemci platform backend’idir; hedef firmanın MCP sunucusudur. Firma senin authorization server’ına güvenmeyi seçerse tokenı senin sistemin verir. Firma kendi sistemini seçerse tokenı oradan alırsın. Trafik yönü, tokenı kimin verdiğinden bağımsız olarak platformdan firma endpoint’ine doğrudur.

### 06.5 Makine yetkisi kullanıcı yetkisi değildir

`client_credentials` uygulamanın kendi adına veya önceden kararlaştırılmış erişim kapsamında yetki alması içindir. Tek başına “bu kullanıcı kendi hesabından para gönderilmesine izin verdi” kanıtı değildir. [S06]

> **Bu projede kural:** Platform oturumu, firma yönetici oturumu, kullanıcı bağlantısı ve servisler arası erişim aynı kayıt veya aynı token olarak tasarlanmayacak.

<!-- PAGE -->

# 07 · “Benim OAuth’um” için iki model

### 07.1 Model A — Firma platformun yetkilendirme sistemine güvenir

Kafandaki asıl modele en yakın seçenek budur. Firma, kendi MCP endpoint’i için senin authorization server’ını güvenilir kabul eder. Kullanıcıya, kapsamı tanımlı bir yetkilendirme deneyimi sunulur. Senin altyapın o firma kaynağına yönelik token verir; firma SDK’sı bunu doğrular.

Ama iki anlaşma gerekir: **Tokenın güvenilirliği** ve **bu kimliğin firmanın hangi müşterisine karşılık geldiği**. Sadece imzayı doğrulamak ikinci soruyu çözmez. Firma, kullanıcıyı kendi hesabında doğrulamalı veya önceden kabul ettiği güvenilir bir hesap eşleme süreci kullanmalıdır.

Örneğin platformdaki `user_123`, firmada `customer_789` olabilir. Bu eşlemeyi modelin verdiği e-posta veya serbest bir müşteri numarasıyla kurmayız. İlk bağlantıda hesap sahipliği kanıtlanır; sonrasında firma kendi kayıt ve işlem yetkilerini denetler.

### 07.2 Model B — Firma kendi yetkilendirme sistemini kullanır

Kullanıcı platformda “bağlan” seçer; firmanın yetkilendirme ekranına gider. İzin sonrasında platform, firmanın MCP kaynağı için düzenlenmiş erişim tokenıyla çağrı yapar. Platformun görevi bağlantıyı ve token yaşam döngüsünü yönetmektir; firmanın yetkilendirme otoritesinin yerine geçmek değildir.

Bu modelin hangi firmaya uygun olduğunu şirket büyüklüğünden çok mevcut altyapı, güven ilişkisi ve partner şartları belirler. Bankanın kendi OAuth sistemini kullanması makul bir senaryodur; ancak burada belirli bir bankanın entegrasyon kabul ettiğini varsaymıyoruz.

### 07.3 Önerilen ürün kararı

**Ortak SDK ve araç sözleşmesi sabit, tokenı veren sistem değişebilir olsun.** İlk çalışan sürümde tek model uygulanabilir; fakat veri modelinde “bütün tokenları daima biz basarız” varsayımını sabitlemeyelim. Hangi modeli önce uygulayacağımızı ilk pilot firmanın koşullarıyla seçelim.

“Kendi OAuth’umuz” ifadesi ayrıca protokolü ve kriptografiyi sıfırdan yazmak anlamına gelmesin. Kendi markamız ve politikalarımız altında olgun bir authorization server kullanmak da bu modeldir.

### 07.4 Tokenın hedefini karıştırma

MCP için alınan tokenın hedef kaynağa uygunluğu doğrulanmalıdır. Başka servis için düzenlenmiş tokenı MCP sunucusuna kabul ettirip arkadaki API’ye aynen taşımak doğru bir köprü değildir. [S10]

Firma SDK’sı ayrı bir API’ye gidiyorsa, o ikinci erişimin kendi yetkilendirme modeli bulunmalı. Hedef API’yi çağırma hakkı, ilk tokenı kopyalayarak kendiliğinden oluşmaz.

<!-- PAGE -->

# 08 · Kullanıcı bağlantısının yaşam döngüsü

### 08.1 İlk bağlantı akışı

Önerilen kullanıcı akışı beş aşamadır. **Seçim:** Kullanıcı firma ve bağlamak istediği hesabı seçer. **Yetkilendirme:** İlgili authorization server’da gerekli izinler alınır. **Dönüş:** Platform, başlattığı akışa ait güvenli callback’i doğrular. **Eşleme:** Firma hesabının hangi platform kullanıcısına bağlı olduğu doğrulanır. **Kayıt:** Bağlantı aktif hâle getirilir; yalnızca gerçekten verilen izinler kaydedilir.

Kullanıcı izin ekranını kapatırsa veya eşleme tamamlanmazsa bağlantı aktif sayılmaz. Firmanın katalogda bulunması bu sonucu değiştirmez.

### 08.2 OAuth uygulama ilkeleri

Etkileşimli bağlantı için Authorization Code + PKCE temelini öneriyorum. Dönüş adresi, başlatılan istek ve seçilen issuer ilişkilendirilmeli; akış başka kullanıcı veya sağlayıcıya bağlanmamalı. Parola toplama ve eski implicit/password grant yaklaşımları tercih edilmemelidir. Bu güvenlik yönü RFC 9700 ile temellendirilir. [S09]

MCP’nin HTTP yetkilendirme modelinde protected-resource metadata üzerinden discovery ve hedef kaynak için `resource` kullanımı bulunur. Platform endpoint ve issuer bilgisini güvenilir kaynaktan almalı; bunları modelin ürettiği URL’lere teslim etmemeli. [S08]

### 08.3 Bağlantı, yalnızca token değildir

Kavramsal bağlantı kaydı; platform kullanıcısını, varsa tenant’ı, firmayı, bağlı dış hesabı, verilen izinleri, durumunu ve gizli kaydına referansı taşır. Aynı kullanıcı aynı firmada birden fazla hesap bağlayabiliyorsa bunlar birbirinden ayrılır.

Çağrı anında kullanıcı kimliği uygulamanın doğrulanmış oturumundan gelir. Modelin verdiği `userId`, `tenantId` veya `connectionId`, tek başına erişim kanıtı değildir. Model bir hesap seçimi önerse bile sahiplik backend’de kontrol edilir.

### 08.4 Yenileme, ek izin ve bağlantı kesme

Token süresi dolduğunda desteklenen akışla yenilenir; refresh token verilmeyebilir. Gereken ek izin kullanıcıya açıklanarak alınır. İzin yenileme başarısızsa sistem başka kullanıcının veya daha geniş yetkili bir servis hesabının tokenına geçmez. [S08]

Bağlantı kesildiğinde platform yeni çalıştırmaları durdurur, bekleyen onayları geçersizleştirir ve sağlayıcının desteklediği iptal işlemlerini uygular. Ancak zaten gönderilmiş bir ödeme otomatik geri alınmış sayılmaz. Onun sonucu ayrıca takip edilir. **Bağlantı durumu ile iş işleminin durumu ayrı kayıtlardır.**

<!-- PAGE -->

# 09 · AI’ın sınırı ve izin kararı

### 09.1 Modelin rolü

Modelin görevi niyeti anlamak, gerekirse soru sormak, uygun aracı seçmek ve girdileri hazırlamaktır. Hangi kullanıcı olduğu, hangi tokenın kullanılacağı, izin kontrolünün geçip geçmediği ve onayın tamamlanıp tamamlanmadığı modelin kararına bırakılmaz.

“Sadece MCP kullan” talimatı tek başına koruma değildir. Önerilen uygulamada modele genel HTTP, shell, sınırsız SQL veya “istenen URL’yi çağır” aracı verilmez. Tool çalıştırma yalnızca kontrollü geçitten yapılır. Böylece hedef dışı çağrı yolları azaltılır; fakat izinli araçların yanlış kullanılma riski tamamen ortadan kalkmış sayılmaz.

### 09.2 Her çağrı için birleşik kontrol

Önerilen karar şu bileşenlerin birlikte geçmesine dayanır:

```text
Geçerli kullanıcı ve doğru bağlantı
+ onaylanmış araç/sürüm
+ gerekli OAuth izni
+ firma hesabı ve nesne üzerinde erişim hakkı
+ platformun işlem politikası
+ gerekiyorsa o işleme bağlı geçerli kullanıcı onayı
= çalıştırılabilir istek
```

Bunlardan biri eksikse modelin ısrarı sonucu değiştirmez. Gateway’in izin vermesi, firmanın kendi denetimini kaldırmaz; firma son kararını kendi hesap ve iş kurallarına göre verir.

### 09.3 Risk sınıflandırması önerisi

Başlangıçta sıradan okuma, hassas okuma, geri alınabilir yazma ve yüksek etkili yazma ayrımı yeterlidir. “Okuma” otomatik olarak zararsız demek değildir; hesap hareketleri veya kişisel bilgiler özel bir paylaşım sınırı gerektirebilir.

İlk sürümde para hareketi, dışarıya mesaj gönderme, satın alma ve silme gibi etkili işlemlerde açık onay öneriyorum. Tutar küçük diye otomatik ödeme varsayılanını koymayalım. Daha sonra gözetimsiz işlem istenirse limit, süre, alıcı, toplam bütçe ve iptal şartlarıyla ayrı bir ürün özelliği tasarlarız.

### 09.4 Veri aktarımı da bir karardır

Kullanıcı bir firmanın verisini okumaya ve başka firmada kayıt oluşturmaya ayrı ayrı izin vermiş olabilir. Bu, ilk firmanın bütün verisinin ikinciye gönderilmesini otomatik onaylamaz. Araçlar arası veri aktarımında amaç, hedef ve paylaşılacak alanlar da kontrol edilmelidir.

Model yalnızca o konuşma için uygun araçları görsün; buna rağmen görünmeyen bir aracı çağırmayı denerse backend reddetsin. **Katalog filtreleme kullanılabilirliği iyileştirir; gerçek erişim denetiminin yerine geçmez.**

<!-- PAGE -->

# 10 · Baştan sona örnek: okuma ve ödeme

### 10.1 Düşük etkili okuma

Kullanıcı “son siparişlerimi göster” der. Platform uygun bağlantıyı ve aracı belirler; araç girdisi doğrulanır. Gateway izinleri kontrol edip firmaya çağrı yapar. Firma isteği kendi müşterisine bağlayarak yalnızca onun kayıtlarını döndürür. Sonuç doğrulanıp gerekli alanlarıyla modele verilir; model bunları kullanıcıya anlatır.

Model bu sırada kullanıcı kimliğini veya tokenı üretmez. Birden fazla firma bağlantısı varsa ve seçim belirsizse kullanıcıdan seçim alınır.

### 10.2 Ödeme: önerilen üç aşamalı sözleşme

**Hazırla:** Kullanıcı “Ahmet’e 500 TL gönder” der. Hangi hesap ve hangi Ahmet olduğu netleştirilir. `payments_prepare` taslağı oluşturur. Alıcı, tutar, para birimi, ücret, toplam ve son geçerlilik zamanı güvenilir sonuçtan alınır. Bu aşama para hareketi yaratmayacak şekilde sözleşmeye bağlanır.

**Onaylat:** Arayüz, sunucuda tutulan taslağı kullanıcıya gösterir. Modelin serbest yazdığı özet tek onay kaynağı yapılmaz. Kullanıcı işlemi açıkça onaylar. Onay; kullanıcıya, bağlantıya, araç sürümüne ve taslağın tam içeriğine bağlanır. Tutar veya alıcı değişirse eski onay geçersizleşir.

**Çalıştır ve doğrula:** Gateway, güncel yetkiyi ve onayı tekrar kontrol ederek `payments_execute` çağrısını yapar. Sonuç kesin değilse `payments_get_status` gibi bir durum sorgusu veya doğrulanmış olayla takip edilir. “Talep alındı” bilgisi “para karşı tarafa geçti” diye sunulmaz.

### 10.3 Onay nasıl atlanamaz?

Modelin araç girdisine `approved: true` yazması yeterli kabul edilmez. Onay sunucuda saklanır; çalıştırma girişimi o kayıtla eşleşmek zorundadır. Tıklamanın kimden geldiği, süresi ve tek kullanımlılığı backend’de doğrulanır.

Aynı onayla iki eşzamanlı çağrının iki ödeme üretmemesi için onay tüketimi ve işlem başlatma kalıcı, yarışa dayanıklı bir akışla yönetilir. Bunun veritabanı ve kilitleme ayrıntısı stack aşamasında seçilir.

### 10.4 Gerçek banka entegrasyonu sınırı

Bu üç araç önerdiğimiz partner sözleşmesidir. Banka taslak API’si sunmuyorsa adapter’da farklı bir karşılık veya güvenli platform taslağı gerekebilir. İşlem anındaki ücret ve koşullar onaylanan içeriği değiştirirse yeniden onay alınır.

Chat onayı bankanın istediği güçlü doğrulamanın yerine geçmez. Yüksek güvenlikli OAuth uygulamaları için FAPI 2.0 gibi profiller vardır; gerçek entegrasyonun güvenlik ve operasyon şartları banka ile doğrulanmalıdır. [S13]

<!-- PAGE -->

# 11 · Güvenilir çalıştırma ve hata davranışı

### 11.1 Sohbet belleği işlem kaydı değildir

Ödeme, satın alma veya uzun süren bir iş yalnızca mesaj geçmişinde takip edilmemeli. Önerilen kalıcı durumlar: **taslak, onay bekliyor, çalıştırılıyor, tamamlandı, başarısız, iptal edildi, süresi doldu, sonucu belirsiz**. Her deneme ayrıca kaydedilir.

Kullanıcı sekmeyi kapatsa veya model çağrısı kesilse bile işin gerçek durumu bu kayıttan izlenebilir. “İptal istendi” de dış sistemdeki işlemin kesin iptal edildiği anlamına gelmez; sağlayıcı sonucu belirleyicidir.

### 11.2 Zaman aşımı başarısızlık kanıtı değildir

Firma işlemi tamamlayıp cevabı yolda kaybedebilir. Böyle bir durumda yeni ödeme gönderilirse çift işlem oluşabilir. Önerilen davranış, sonucu belirsiz olarak işaretleyip mevcut işlem kimliğiyle durum sormaktır. Kullanıcıya da “sonucu doğruluyoruz” denir; doğrulama yokken başarı veya başarısızlık uydurulmaz.

### 11.3 Idempotency: aynı işin tekrarını tanımak

Tek iş için kalıcı bir idempotency anahtarı üretmeyi ve tekrar denemelerde aynı anahtarı kullanmayı öneriyorum. Anahtar; kullanıcı/bağlantı, işlem türü ve aynı içerikle ilişkilendirilsin. Değişen içerikle aynı anahtarın kullanımı reddedilsin.

Bazı API’ler aynı anahtarla gelen tekrarlar için önceki sonucu döndürür; Stripe bunun belgelenmiş bir örneğidir. Ama bu davranış bütün firmalarda varmış gibi kabul edilemez. [S12]

**Gateway’de tekrarları engellemek tek başına dış dünyada “tam bir kez” çalışma garantisi vermez.** Firma tarafında da atomik tekrar önleme veya eşdeğer iş mekanizması gerekir. Böyle bir garanti yoksa yüksek etkili yazma işleminde otomatik tekrar denemeyi açmayalım. JSON-RPC istek numarası da iş düzeyindeki bu garantinin yerine geçmez.

### 11.4 Hatalar farklı ele alınmalı

Geçersiz girdi kullanıcıya düzelttirilir. Eksik izin bağlantı/izin akışına götürür. Süresi dolmuş token uygun biçimde yenilenir. Firma kuralından kaynaklanan ret tekrarlarla zorlanmaz. Geçici erişim hatasında bekleme uygulanabilir; ancak yazma işlemi için güvenli tekrar koşulu ayrıca aranır.

Polling veya webhook ile gelen sonuçlar yinelenebilir ve sıra dışı gelebilir. Kimlik doğrulama, olay tekilleştirme ve geçerli durum geçişleri tasarlansın. Birkaç firmayı kapsayan işlerde tek bir küresel transaction varsayılmasın: sonraki adım başarısız olduğunda önceki adımı geri almak ayrı ve bazen mümkün olmayan bir iş olabilir.

<!-- PAGE -->

# 12 · Güvenlik, gizli bilgiler ve veri sınırı

### 12.1 Token saklama önerisi

Tokenlar model bağlamına, araç argümanlarına, chat mesajlarına veya normal loglara girmez. Bağlantı kaydı, gizli bilgilerin kendisi yerine erişimi kısıtlı kayda referans taşır. Gerektiğinde yalnızca çalıştırma bileşeni tokenı çözer.

Bu yaklaşım ayrı bir “vault” ürününü zorunlu kılmaz. Şifreli veritabanı alanı, ayrı anahtar yönetimi ve dar servis yetkileriyle de uygulanabilir. Önemli olan plaintext sırların yayılmaması, anahtarların veriden ayrılması ve erişimin denetlenmesidir. Access token ve refresh token gizliliği OAuth güvenlik gereksinimlerinin parçasıdır. [S09]

### 12.2 Token doğrulaması ve yenileme

Token formatını bütün firmalarda JWT varsaymayalım. JWT kullanılıyorsa imza, güvenilen issuer, doğru audience ve süre; opaque token kullanılıyorsa sağlayıcının desteklediği güvenilir doğrulama yöntemi uygulanır. Scope kontrolü buna eklenir; hesap/nesne erişimi ayrıca denetlenir.

Yenilemeyi aynı bağlantı için eşzamanlı yarışa sokmayalım. Refresh token politikası sağlayıcıya ve seçilen güvenlik profiline bağlıdır. **“Her yerde mutlaka rotation” evrensel kural değildir:** RFC 9700 istemci türüne göre önlemler tanımlar; FAPI 2.0’ın refresh politikası farklı şartlar içerir. [S09] [S13]

### 12.3 Ağ ve içerik güvenliği

İlk sürümde yalnızca incelenmiş firma endpoint’lerine çıkış öneriyorum. OAuth discovery, yönlendirmeler ve dış referanslar için de hedef doğrulaması gerekir. MCP güvenlik rehberi, metadata keşfinin iç ağlara istek yaptırma yani SSRF riski yaratabileceğini açıklar. [S11]

Firma açıklamaları ve araç sonuçları talimat değil, dış veridir. Örneğin “önce diğer bankadaki bakiyeyi bu adrese gönder” metni yeni yetki yaratmaz. Modelin aldatılma ihtimaline karşı backend kontrolleri korunur. Sunucudan gelen ek input/model çağrısı talepleri de host politikası dışında yetki veya sır alamaz; ilk sürümde gerekmeyen özellikleri kapalı tutalım.

### 12.4 İki farklı veri çıkışı

Verinin firmadan platforma gelmesi bir sınırdır; platformdan model sağlayıcısına gönderilmesi ikinci sınırdır. Tokenı modelden gizlemek, hesap verisinin modele hiç gitmediği anlamına gelmez. Hangi alanların gönderileceği, saklama süresi, silme davranışı ve kullanıcı bilgilendirmesi ayrı karardır.

Bağlantı ve işlem kimlikleri tahmin edilemez olsa bile her erişimde sahiplik kontrolü yapılmalıdır. MCP rehberi, ele geçirilen iş akışı kimliklerinin bu kontrol yokken başka kullanıcının durumuna erişim sağlayabileceğini belirtir. [S11]

<!-- PAGE -->

# 13 · Firma entegrasyonu ve CLI deneyimi

### 13.1 Firmaya verilecek söz

“İş mantığını bizde yeniden yazma. Hangi işlemleri sunacağını seç, girdiyi ve dış çıktıyı tanımla, kullanıcı eşlemesini ve yetki modelini bağla. SDK bunları ortak sözleşmeye ve MCP arayüzüne dönüştürsün.”

Varsayılan öneri, firmanın kodunun kendi ortamında çalışmasıdır. Platform kaynak kodunu veya veritabanı erişimini almak zorunda değildir. Bununla birlikte çağrılan aracın döndürdüğü veriyi alır; “kod firmada kalıyor” ifadesi “hiç veri aktarılmıyor” anlamına gelmez.

### 13.2 Önerilen CLI aşamaları

**Kontrol:** Eksik tanım, çözülemeyen referans, desteklenmeyen şema özelliği ve eksik güvenlik bilgisini gösterir. **Paketleme:** Sürümlü sözleşmeyi ve gereken metadata’yı üretir. **Yerel test:** Örnek girdilerle güvenli bir test ortamında çalıştırır. **Yayın:** Doğrulanmış firma kimliğiyle endpoint ve sözleşme sürümünü platforma kaydeder.

Bunlar komut adı veya mevcut SDK özelliği iddiası değil, CLI sorumluluklarıdır. Yerel geliştirme için açılan süreç, kendi başına production’da erişilebilir ve sürekli çalışan servis değildir. Üretim dağıtımı, sağlık kontrolü ve erişilebilirlik firmanın dağıtım modelinde çözülür.

### 13.3 Platformdaki kabul kapısı

Endpoint kaydı otomatik güven yaratmaz. Firma kimliği ve endpoint sahipliği doğrulanmalı; yayınlanan araçlar incelenmeli. Yetkisiz kullanıcı, başka tenant, bozuk response, süresi dolmuş token ve tekrar edilen yazma çağrısı test edilmelidir. İncelenen sürümün dışına çıkan değişiklikler yeniden kabul sürecine girmelidir.

Firmanın beyan ettiği araç listesiyle canlı sunucunun listesi karşılaştırılır. Bir tool katalogdan kaldırıldığında veya entegrasyon askıya alındığında mevcut model bağlamında görünse bile yeni çağrısı reddedilir.

### 13.4 Protokol sürümünü sabitle

12 Eylül 2026 kontrolünde resmî MCP kaynağı `2026-07-28` sürümünü yayımlanmış sürüm olarak gösteriyor. Bu sürüm stateless protokol çekirdeği ve yeni istek mekanizmaları içeriyor. Bu nedenle SDK ve istemcinin uyumluluğu sürümle birlikte test edilmeli; eski bağlantı varsayımları otomatik taşınmamalıdır. [S14]

Stateless MCP, ödeme taslağı veya onay kaydı tutmayacağımız anlamına gelmez. Protokolün bağlantı durumu ile ürünün kalıcı iş durumu ayrı kavramlardır. [S14]

<!-- PAGE -->

# 14 · Kavramsal kayıtlar ve operasyon

### 14.1 Veritabanı ürünü seçmeden bile gereken kayıtlar

| Kayıt                       | Hangi soruyu cevaplar?                                             |
| --------------------------- | ------------------------------------------------------------------ |
| Firma ve entegrasyon        | Kimin endpoint’ine, hangi ortam ve güven ilişkisiyle bağlanıyoruz? |
| Araç sözleşmesi             | Hangi işlemin hangi sürümü onaylandı?                              |
| Kullanıcı bağlantısı        | Bu kullanıcı hangi dış hesaba, hangi izinlerle bağlı?              |
| Politika                    | Hangi koşulda izin, ret veya ek onay gerekiyor?                    |
| İşlem ve onay               | Tam olarak ne onaylandı; hangi iş başlatıldı?                      |
| Çalıştırma denemesi ve olay | Hangi istek yapıldı, sağlayıcı ne bildirdi, sonuç kesin mi?        |

Bunlar nihai SQL tabloları değildir. Birlikte veya ayrı saklanabilirler; ama kavramsal olarak birbirine karıştırılmamaları gerekir. Özellikle “onay kaydı” ile “modelin onay hakkında yazdığı mesaj” eşdeğer tutulmaz.

### 14.2 İzlenebilirlik önerisi

Kullanıcı isteğinden firma sonucuna kadar ilişkilendirilebilir bir işlem izi tutulmalı. Hangi araç sürümünün kullanıldığı, hangi politika kararı verildiği, onay ve idempotency ilişkisi, sağlayıcı işlem numarası ve son durum izlenebilmeli.

Audit kaydı her şeyi ham hâliyle loglamak demek değildir. Tokenları, gereksiz kişisel verileri ve bütün hesap dökümlerini loga kopyalamayız. Ne kadar verinin ne süre tutulacağı ayrıca kararlaştırılır; kayıtlara erişim ve değişiklikler denetlenir.

### 14.3 Minimum işletim yetenekleri

Firma veya araç bazında çağrıları durdurabilmeliyiz. Sağlayıcı limitleri, zaman aşımı, kullanıcı başına çağrı bütçesi ve modelin aynı işi tekrar tekrar denemesi sınırlandırılmalı. Sağlayıcı devre dışıyken kullanıcıya kesin olmayan sonuç kesinmiş gibi gösterilmemeli.

İlk ölçümler; araç başarısı, yetki reddi, şema hatası, onay tamamlama, belirsiz kalan işlem sayısı, sağlayıcı gecikmesi ve kullanıcı başına maliyet olabilir. Bunlar optimizasyon için önerilen ölçümlerdir; üretim hedefleri henüz belirlenmedi.

### 14.4 Çok sayıda firmaya büyürken

Binlerce aracı her model isteğine eklemek yerine, kullanıcıya ve niyete uygun küçük bir aday kümesi seçmeyi öneriyorum. Seçilen aracın tam sözleşmesi çalıştırmadan önce yüklenir. Katalog cache’i kullanıcı, tenant, izin ve sürüm farklarını karıştırmamalı.

Kuyruk, ayrı worker veya mikroservis ihtiyacı ölçülen iş yüküyle belirlenir. **Mantıksal sorumlulukların ayrı olması, hepsinin ilk günden ayrı deploy edilmesini gerektirmez.**

<!-- PAGE -->

# 15 · Adım adım geliştirme planı

### Aşama 1 — Mevcut SDK sözleşmesini netleştir

Çıktı: Bir okuma aracı, bir recursive response örneği ve bir geri alınabilir yazma aracı için ortak tanım. Henüz gerçek banka veya gerçek ödeme yok.

**Geçiş koşulu:** İşaretlenmeyen metot açılmıyor; eksik tip ve bozuk referans yakalanıyor; girdi/çıktı doğrulanıyor; güvenilir kimlik alanları model girdisinden ayrılıyor.

### Aşama 2 — Tek pilot firma ile kimlik ve bağlantı

Çıktı: Seçilen OAuth modeliyle çalışan, hesap eşlemesi doğrulanmış kullanıcı bağlantısı. Test için kendi kontrolümüzdeki örnek firma kullanılabilir.

**Geçiş koşulu:** Kullanıcı A, B’nin bağlantısını veya kaydını kullanamıyor. Yanlış hedefe ait token reddediliyor. Bağlantı kesildiğinde yeni çağrı duruyor. OAuth/SDK erişimi ilk günden korunuyor; güvenlik sonraya bırakılmıyor.

### Aşama 3 — Chat’ten salt okunur uçtan uca akış

Çıktı: Kullanıcı isteği → araç seçimi → politika → MCP → firma → doğrulanmış sonuç. Model adapter’ı gerçek örnekler üzerinde test edilir.

**Geçiş koşulu:** Bilinmeyen araç ve kötü biçimli girdi çalışmıyor. Araç sonucundaki kötü niyetli talimat yeni yetki yaratmıyor. Hassas veya büyük response, belirlenen veri sınırının dışına çıkmıyor.

### Aşama 4 — Onaylı ve geri alınabilir yazma

Çıktı: Örneğin sipariş taslağı oluşturma üzerinden işlem durumu, onay bağı ve idempotency mekanizması.

**Geçiş koşulu:** Çift tıklama ve eşzamanlı çağrı çift iş üretmiyor. İçerik değişince eski onay geçmiyor. Zaman aşımı belirsiz durum olarak izleniyor. Yeniden başlatma sonrasında işlem kaydı kaybolmuyor.

### Aşama 5 — İkinci firma ve operasyon testi

Çıktı: Mümkünse farklı yetkilendirme modeli kullanan ikinci entegrasyon; CLI yayınlama, sürüm kontrolü, yetki izolasyonu ve araç durdurma.

**Geçiş koşulu:** Bir firma için yazılmış varsayımlar diğerini bozmuyor. Firma/araç/izin değişikliği güvenli davranıyor. Token yenileme yarışları ve tekrarlı olaylar yönetiliyor.

### Aşama 6 — Yüksek etkili işlem pilotu

Gerçek para hareketi ancak partnerin teknik ve operasyon şartları netleştiğinde, sandbox testleri ve güvenlik değerlendirmesi sonrasında ele alınır. Önceki aşamalarda kanıtlanmamış güvenilirlik davranışları burada varsayılmaz.

> **İlk somut çalışma:** Yeni altyapı seçmek değil; mevcut SDK’dan tek bir yeteneğin nasıl tam araç sözleşmesine dönüştüğünü birlikte kesinleştirmek.

<!-- PAGE -->

# 16 · Karar defteri: stack’i nasıl tamamlayacağız?

Bu tablo karar verildiği izlenimi yaratmamak için açık tutulmuştur. “Başlangıç önerisi”, sonraki konuşmada değiştirilebilir varsayılan yöndür.

| Karar                                        | Başlangıç önerisi                                                 | Durum |
| -------------------------------------------- | ----------------------------------------------------------------- | ----- |
| K01 · İlk hedef kapsam                       | Tek firma, kullanıcı bağlantısı ve okuma akışı.                   | Açık  |
| K02 · Firma kodu nerede çalışır?             | Firmanın kendi ortamında.                                         | Açık  |
| K03 · İlk OAuth modeli                       | İlk pilotun kabul ettiği issuer modeli; iki modele uygun tasarım. | Açık  |
| K04 · SDK’nın merkezi çıktısı                | Framework bağımsız, sürümlü araç sözleşmesi.                      | Açık  |
| K05 · MCP çağrısı iş mantığına nasıl ulaşır? | Ortak, yetkilendirilmiş iş servisi; mevcut guard’lar atlanmaz.    | Açık  |
| K06 · İşlem onayı                            | Etkili yazmalarda sunucu kaydına bağlı açık onay.                 | Açık  |
| K07 · Şema/model uyumluluğu                  | Ana sözleşme + test edilmiş model adapter’ı.                      | Açık  |
| K08 · Başlangıç dağıtımı                     | Tek modüler backend; yalnızca gerektikçe ayrı worker.             | Açık  |

### 16.1 Stack seçiminin sırası

Önce sözleşme ve çalıştırma sınırı; sonra kullanıcı/hesap eşlemesi ve OAuth modeli; ardından kalıcı işlem kaydı ve onay davranışı netleşsin. Bundan sonra auth ürünü, backend bileşenleri, veritabanı, secret yönetimi, model adapter’ı ve dağıtım seçimi anlamlı hâle gelir.

Örneğin auth ürünü seçmeden önce onun bizim adımıza authorization server mı, kullanıcının chat’e girişi için kimlik sağlayıcısı mı, yoksa dış OAuth bağlantılarını yöneten bileşen mi olacağını bilmeliyiz. Aynı ürün bunlardan birden fazlasını sağlayabilir; bu sorumlulukların aynı olduğu anlamına gelmez.

### 16.2 İlk konuşmada çözeceğimiz sınır

**Mevcut decorator tam olarak hangi bilgileri topluyor ve bunun ne kadarı otomatik şema, ne kadarı geliştiricinin açık iş tanımı olmalı?** Bu sorunun cevabıyla ortak sözleşmeyi sabitleyebiliriz. Sonraki aşamada OAuth ve çalışma zamanı bağlamını bu sözleşmeye bağlarız.

### 16.3 Korunacak temel yaklaşım

Mevcut SDK yeniden yazılacak varsayımı yok. Firma iş mantığını bize taşımak zorunda değil. AI yetkilendirme otoritesi değil. MCP güvenlik politikasının yerine geçmiyor. OAuth bağlantısı her işlem için sınırsız onay değil. JSON Schema doğrulaması da iş kuralı ve hesap sahipliği denetiminin yerine geçmiyor.

**Hedef, çok sayıda teknolojiyi bir araya getirmek değil; tek bir yeteneğin tanımından güvenilir sonucuna kadar olan yolu anlaşılır ve test edilebilir yapmak.**

<!-- PAGE -->

# 17 · Terimler ve okuma notları

| Terim          | Bu dokümandaki anlamı                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| SDK            | Firmanın seçilmiş işlevlerini tanımlamasına ve çalıştırmasına yardımcı kütüphane.                     |
| Adapter        | Bir framework’ü veya model arayüzünü ortak sözleşmeye bağlayan uyarlama katmanı.                      |
| Araç / tool    | AI’ın çağrılmasını önerebildiği, tanımlı girdi ve çıktısı olan işlem.                                 |
| Manifest       | Platformun entegrasyon hakkında kullandığı sürümlü tanım paketi; tüm alanları MCP standardı değildir. |
| Gateway        | Çağrıların yetki ve çalıştırma kontrolünden geçtiği mantıksal katman.                                 |
| Orkestrasyon   | Kullanıcı isteği, model ve araç çağrılarının akışını yöneten uygulama mantığı.                        |
| Tenant         | Aynı platformu kullanan, verisi ve yetkileri diğerlerinden ayrılan kuruluş/çalışma alanı.             |
| Scope          | Tokenla verilen erişimin kapsamını ifade eden izin adı.                                               |
| Issuer         | Tokenı veya kimlik beyanını veren güvenilir sistem.                                                   |
| Audience       | Tokenın kullanılmasının amaçlandığı kaynak veya alıcı.                                                |
| Consent        | Kullanıcının belirli erişim veya paylaşım kapsamına verdiği izin.                                     |
| İşlem onayı    | Tek bir somut işlemin içeriğine bağlı kabul; genel bağlantı izninden ayrıdır.                         |
| Idempotency    | Aynı işin tekrar denemelerini ikinci bir iş yaratmadan ele alma özelliği.                             |
| Reconciliation | Platformdaki kayıtla dış sistemin gerçek sonucunu karşılaştırıp durumu netleştirme.                   |

OAuth ve kimlik terimleri için [S06]–[S10], idempotency için örnek uygulama olarak [S12] incelenebilir. Diğer tanımlar bu dokümanın kavramsal kullanımını açıklar.

### Kaynaklarla önerilerin ayrımı

Kaynaklar, standartların ve mevcut teknik davranışların dayanağıdır. Araç risk sınıfları, üç aşamalı ödeme akışı, modüler backend önerisi, karar defteri ve geliştirme aşamaları bu proje için hazırlanmış tasarım önerileridir; standartlar bunları bizim adımıza eksiksiz tanımlamaz.

Metindeki araç adları, kayıt adları ve CLI aşamaları uygulama sözleşmesini anlatan örneklerdir. Hazır bir SDK API’si veya gerçek bir banka entegrasyonu gibi kullanılmamalıdır. Protokol sürümüne bağlı uygulama ayrıntıları kodlama aşamasında seçilen SDK sürümüyle yeniden test edilmelidir.

<!-- PAGE -->

# 18 · Resmî kaynaklar

**Kontrol tarihi: 12 Eylül 2026.** Kaynaklara “Kaynağı aç” bağlantılarından ulaşılabilir. MCP için tarihli sürüm bağlantıları kullanılmıştır; farklı sürümlerdeki örnekler karıştırılmamalıdır.

**[S01] Model Context Protocol — Tools, 2026-07-28.** Araç tanımı, girdi/çıktı şemaları, yapılandırılmış sonuç ve annotation güveni. [Kaynağı aç](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)

**[S02] NestJS — OpenAPI: Types and Parameters.** Decorator/reflection yaklaşımı; circular bağımlılıklar, generics ve interface sınırlamaları. [Kaynağı aç](https://docs.nestjs.com/openapi/types-and-parameters)

**[S03] NestJS — Guards.** İstek yaşam döngüsünde erişim kontrolü. [Kaynağı aç](https://docs.nestjs.com/guards)

**[S04] JSON Schema — Structuring a Complex Schema.** Ortak tanımlar, referanslar ve recursive şemalar. [Kaynağı aç](https://json-schema.org/understanding-json-schema/structuring)

**[S05] OpenAPI Specification 3.1.1 — Schema Object.** JSON Schema 2020-12 temeli ve şema dialect’i. [Kaynağı aç](https://spec.openapis.org/oas/v3.1.1.html#schema-object)

**[S06] IETF — RFC 6749: OAuth 2.0 Authorization Framework.** OAuth rolleri ve client credentials kapsamı; güvenlik uygulamasında S09 ile birlikte okunmalı. [Kaynağı aç](https://www.rfc-editor.org/rfc/rfc6749.html)

**[S07] OpenID Foundation — OpenID Connect Core 1.0, errata set 2.** OAuth üzerindeki kimlik doğrulama katmanı. [Kaynağı aç](https://openid.net/specs/openid-connect-core-1_0.html)

**[S08] Model Context Protocol — Authorization, 2026-07-28.** OAuth rolleri, discovery, resource göstergesi, token ve izin yaşam döngüsü. [Kaynağı aç](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

**[S09] IETF — RFC 9700: Best Current Practice for OAuth 2.0 Security.** PKCE, güvenli yönlendirme, token koruması ve refresh güvenliği. [Kaynağı aç](https://www.rfc-editor.org/rfc/rfc9700.html)

**[S10] Model Context Protocol — Authorization Security Considerations.** Audience doğrulaması, token geçişleri ve yetkilendirme saldırıları. [Kaynağı aç](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)

**[S11] Model Context Protocol — Security Best Practices, 2026-07-28.** SSRF, confused deputy ve iş durumu kimliklerinin korunması. [Kaynağı aç](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)

**[S12] Stripe — Idempotent Requests.** Aynı anahtarla güvenli tekrar denemenin sağlayıcıya özgü bir uygulama örneği. [Kaynağı aç](https://docs.stripe.com/api/idempotent_requests)

**[S13] OpenID Foundation — FAPI 2.0 Security Profile, final.** Yüksek değerli API’ler için OAuth güvenlik profili ve profile özgü token şartları. [Kaynağı aç](https://openid.net/specs/fapi-security-profile-2_0-final.html)

**[S14] Model Context Protocol — The 2026-07-28 Specification.** Yayımlanan sürüm ve stateless protokol çekirdeği değişikliği. [Kaynağı aç](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
