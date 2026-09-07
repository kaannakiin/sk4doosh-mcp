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

Dizin yapısı bu dört modu birebir yansıtır. Kova, dosyanın hangi klasörde olduğuyla belirlenir:

```text
src/content/
  00-introduction.md          <- kovasız: yönlendirme sayfası, tek sayfa, kısa
  tutorial/
  how-to/
  reference/
  explanation/
```

Sıra dosya adındaki sayıdan, başlık ilk `#` satırından gelir. Sidebar `src/lib/content.ts`
tarafından üretilir; kayıt edilecek bir yer yoktur.

## Değişmez kurallar

Bunlar "iyi olur" değil. İhlal edilince doküman çürür.

### 1. Bir sayfa = bir mod

En çok ihlal edilen kural. Tutorial'ın ortasına reference tablosu koymak iki modu birden bozar:
öğrenen kişi tabloda boğulur, iş yapan kişi tablonun etrafındaki anlatıyı atlamak zorunda kalır.

Aynı konu dört sayfada dört kez anlatılabilir — anlatılmalıdır da. Tekrar değildir; aynı konunun
farklı sorulara verdiği cevaplardır. Görünürlük konusunun dört sayfası bunun örneğidir.

### 2. Reference üretilir, yazılmaz

Makine-okur kaynağı olan hiçbir şey elle yazılmaz. `packages/spec/schemas/*.schema.json` bu
repo'nun tek doğruluk kaynağıdır; tip üretimi için geçerli olan kural doküman için de geçerlidir.

Bir şema alanını reference sayfasına elle kopyalarsan üç ay içinde yalan olur. Bugün üretim
hattı yoksa bile sayfa **şemaya link verir** ve alan listesini şemadan kopyalamaz.

### 3. RFC 2119 anahtar kelimeleri yalnız spec'te

`MUST` / `SHOULD` / `MAY` (ve Türkçe karşılıkları) yalnız `packages/spec/*.md` içinde geçer.
Bir tutorial'da normatif dil kullanmak ikisini birden bozar: tutorial emir kipi kullanır çünkü
öğretiyor, spec normatif kip kullanır çünkü uygulayıcıyı bağlıyor. Aynı kelimeleri paylaşamazlar.

Site sayfaları spec'e link verir, spec'i yeniden yazmaz.

### 4. Her kod örneği koşar

Örnek ya gerçek bir test dosyasından, ya conformance fixture'ından, ya da elle koşulmuş bir
komuttan gelir. Elle uydurulmuş örnek üç ayda yalan olur ve okuyucunun sana olan güvenini
tek seferde bitirir.

Koşulmamış bir örnek yayınlanacaksa sayfanın başına açıkça yazılır. Sessizce yayınlanmaz.

### 5. Tutorial'da tek yol

"Alternatif olarak", "isterseniz", "tercihinize göre" yasak. Dallanma how-to'nun işidir.
Tutorial'ın sözleşmesi şudur: adımları sırayla uygula, sonunda çalışan bir şey elde et.
Her dal bu sözleşmeyi zayıflatır.

Tutorial sonuna kadar götürür; başarı gözle görülür bir çıktıyla biter, "artık hazırsınız" ile değil.

### 6. Policy adları sızmaz

`packages/spec/gorunurluk.md` değişmez 3: policy adları agent'a sızmaz. Aynısı dokümanda da
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
- Repo kökündeki `docs/`, `packages/spec/` ve bu dosya **Türkçe** — iç tasarım dokümanları.
- i18n katmanı yoktur, bilinçli: tek dil, drift yok.

Prose stili için **Google developer documentation style guide** referanstır. Zorlamak için
[Vale](https://vale.sh) eklenebilir; bugün eklenmedi, insan review'ına bırakıldı.

## Sayfa eklerken kontrol listesi

1. Hangi kova? Cevap veremiyorsan sayfayı yazma.
2. Dosya doğru klasörde mi, sayı prefix'i sırayı doğru veriyor mu?
3. Başlık moda uygun kalıpta mı?
4. Kod örneklerinin hepsi koştu mu? Koşmadıysa sayfada yazıyor mu?
5. Şemadan elle kopyalanmış alan listesi var mı? Varsa link'e çevir.
6. Başka bir modun işini yapan bir bölüm sızmış mı? Sızdıysa o bölüm yeni bir sayfadır.
