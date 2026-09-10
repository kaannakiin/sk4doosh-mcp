# Doküman Kuralları

`apps/docs` altındaki her sayfa bu kurallara uyar. Temel: **Diátaxis** — Daniele Procida'nın
taksonomisi (Django, Kubernetes, Cloudflare, Canonical aynısını kullanıyor).

Bu dosya `apps/docs` ekibi içindir, sitede yayınlanmaz. Türkçedir; sitenin içeriği İngilizcedir.

## Dört mod

Diátaxis dokümanı iki eksende böler: pratik/teorik × öğrenirken/çalışırken.

|            | Öğrenirken                    | Çalışırken                    |
| ---------- | ----------------------------- | ----------------------------- |
| **Pratik** | **Tutorial** — elinden tutar  | **How-to** — bir görevi çözer |
| **Teorik** | **Explanation** — neden böyle | **Reference** — ne var, kuru  |

Dizin yapısı **iki eksen** taşır: ürün hattı × mod. Birinci segment ürün, ikincisi Diátaxis
kovasıdır — kova, dosyanın ürün klasörünün hemen altındaki hangi klasörde olduğuyla belirlenir:

```text
src/content/
  products.json               <- ürün kaydı: id, label, tagline (dizi sırası = görünüm sırası)
  http-catalog/
    00-introduction.md        <- kovasız: ürünün yönlendirme sayfası, tek sayfa, kısa
    tutorial/
    how-to/
    reference/
    explanation/
  excel-mcp/                  <- ileride: aynı yapı, kendi kovaları
```

Dört modlu taksonomi değişmedi; yalnız ağaçtaki derinliği değişti.

Sıra dosya adındaki sayıdan, başlık ilk `#` satırından, slug sayı prefix'i atılmış dosya adından
gelir. Route `/docs/<ürün>/<slug>` olduğu için slug yalnız **kendi ürünü içinde** tekil olmak
zorundadır; iki ürün aynı `introduction` slug'ını kullanabilir. Renumber slug'ı değiştirmez —
araya sayfa sokmak hiçbir URL'i kırmaz.

Sidebar `src/lib/content.ts` tarafından üretilir. Yeni **sayfa** için kayıt edilecek bir yer
yoktur. Yeni **ürün** için tek yer `src/content/products.json`'dır: klasörü aç, bir satır ekle.
Yapısal her ihlali `pnpm --filter @sk-mcp/docs validate` CI'da kırar.

## Değişmez kurallar

Bunlar "iyi olur" değil. İhlal edilince doküman çürür.

### 1. Bir sayfa = bir mod

En çok ihlal edilen kural. Tutorial'ın ortasına reference tablosu koymak iki modu birden bozar:
öğrenen kişi tabloda boğulur, iş yapan kişi tablonun etrafındaki anlatıyı atlamak zorunda kalır.

Aynı konu dört sayfada dört kez anlatılabilir — anlatılmalıdır da. Tekrar değildir; aynı konunun
farklı sorulara verdiği cevaplardır. Görünürlük konusunun dört sayfası bunun örneğidir.

### 1b. Bir sayfa = bir ürün hattı

Bir sayfa tek bir ürün hattını anlatır; sayfanın ürünü yoludur. İki ürünü karşılaştıran bir sayfa
yazma isteği geldiğinde o sayfa aslında iki explanation sayfasıdır — veya hiçbiri. Ortak olan şey
ürün değil spec'tir; ortak anlatımın yeri `packages/spec/` ve repo kökündeki `docs/`'tur.

Ürün klasörünün adı, ürünün paket ya da dizin adıyla eşleşir (`excel-mcp`, `xml-mcp`, `file-core`).
`http-catalog` bilinçli istisnadır: bir paketi değil, iki SDK'ya yayılan bir yeteneği — ASP.NET Core
ve NestJS HTTP endpoint kataloğunu — adlandırır.

### 2. Reference üretilir, yazılmaz

Makine-okur kaynağı olan hiçbir şey elle yazılmaz. `packages/spec/schemas/*.schema.json` bu
repo'nun tek doğruluk kaynağıdır; tip üretimi için geçerli olan kural doküman için de geçerlidir.

Bir şema alanını reference sayfasına elle kopyalarsan üç ay içinde yalan olur. Bugün üretim
hattı yoksa bile sayfa **şemaya link verir** ve alan listesini şemadan kopyalamaz.

### 3. RFC 2119 anahtar kelimeleri yalnız spec'te

`MUST` / `SHOULD` / `MAY` yalnız `packages/spec/*.md` içinde geçer.
Bir tutorial'da normatif dil kullanmak ikisini birden bozar: tutorial emir kipi kullanır çünkü
öğretiyor, spec normatif kip kullanır çünkü uygulayıcıyı bağlıyor. Aynı kelimeleri paylaşamazlar.

Site sayfaları spec'e link verir, spec'i yeniden yazmaz.

### 4. Her kod örneği koşar

Örnek ya gerçek bir test dosyasından, ya conformance fixture'ından, ya da elle koşulmuş bir
komuttan gelir. Elle uydurulmuş örnek üç ayda yalan olur ve okuyucunun sana olan güvenini
tek seferde bitirir.

Koşulmamış bir örnek yayınlanacaksa sayfanın başına açıkça yazılır. Sessizce yayınlanmaz.

Sample verisi içeren çıktı blokları **elle çevrilmez ve elle düzenlenmez**. Sample'ın kendi string'i
yanlış dildeyse sample düzeltilip çıktı yeniden üretilir, ya da durum sayfada ifşa edilir. Bu
hipotetik değil: `reference/02-schema-conversion.md`'de ölçülmüş bir JSON bloğunun içinde Türkçe
`description` değerleri aylarca durdu ve kural bu hâliyle onu yakalamadı.

### 5. Tutorial'da tek yol

"Alternatif olarak", "isterseniz", "tercihinize göre" yasak. Dallanma how-to'nun işidir.
Tutorial'ın sözleşmesi şudur: adımları sırayla uygula, sonunda çalışan bir şey elde et.
Her dal bu sözleşmeyi zayıflatır.

Tutorial sonuna kadar götürür; başarı gözle görülür bir çıktıyla biter, "artık hazırsınız" ile değil.

### 6. Policy adları sızmaz

`packages/spec/visibility.md` değişmez 3: policy adları agent'a sızmaz. Aynısı dokümanda da
geçerlidir — örneklerde gerçek müşteri policy adı, tenant adı veya endpoint yolu kullanılmaz.
DemoApi'nin `OrdersRead`, `BusinessHours`, `alice`/`bob`/`carol` kadrosu bu iş için vardır.

### 7. ADR değişmez

`docs/kararlar/` altındaki bir karar kabul edildikten sonra düzenlenmez. Karar değişirse yeni
ADR yazılır, eskisine `superseded by 0NN` notu düşülür. Geçmişi silmek en pahalı hata: altı ay
sonra "bunu neden böyle yapmışız" sorusunun cevabı kalmaz.

## Başlıklar

Mod başlıktan anlaşılır:

| Mod         | Kalıp                      | Örnek                                   |
| ----------- | -------------------------- | --------------------------------------- |
| Tutorial    | `<fiil>ing your first <X>` | `Seeing visibility filtering in action` |
| How-to      | `How to <fiil>`            | `How to control what a caller can see`  |
| Reference   | İsim öbeği                 | `Visibility decision`                   |
| Explanation | Soru veya iddia            | `Why visibility is not enforcement`     |

Başlık soru soruyorsa sayfa explanation'dır. Fiille başlıyorsa tutorial veya how-to'dur.
Bir isimse reference'tır. Başlığı yazarken hangi kovaya girdiğini bilmiyorsan sayfayı henüz
yazmaya hazır değilsin.

## Dil

- Site içeriği ve arayüz metinleri **İngilizce** — site sk-mcp'nin public yüzü.
- `packages/spec/` **İngilizce** — site ona normatif kaynak olarak link verir, aynı kitlenin okuması gerekir.
- Repo kökündeki `docs/` ve bu dosya **Türkçe** — iç tasarım dokümanları.
- i18n katmanı yoktur, bilinçli: tek dil, drift yok.

Prose stili için **Google developer documentation style guide** referanstır. Zorlamak için
[Vale](https://vale.sh) eklenebilir; bugün eklenmedi, insan review'ına bırakıldı.

## Sayfa eklerken kontrol listesi

0. Hangi ürün hattı? Dosya `src/content/<ürün>/` altında mı, ürün `products.json`'da kayıtlı mı?
1. Hangi kova? Cevap veremiyorsan sayfayı yazma.
2. Dosya doğru klasörde mi, sayı prefix'i sırayı doğru veriyor mu?
3. Başlık moda uygun kalıpta mı?
4. Kod örneklerinin hepsi koştu mu? Koşmadıysa sayfada yazıyor mu?
5. Şemadan elle kopyalanmış alan listesi var mı? Varsa link'e çevir.
6. Başka bir modun işini yapan bir bölüm sızmış mı? Sızdıysa o bölüm yeni bir sayfadır.
7. Slug bu ürün hattında tekil mi? Site içi linklerin hepsi var olan bir sayfaya mı gidiyor?
