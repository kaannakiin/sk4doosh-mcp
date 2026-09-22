# Katalog araması — `search_catalog` tasarımı

**Durum:** uygulandı
**Tarih:** 22 Eylül 2026
**Kapsam:** `packages/cores/db-core` (`search/`, `catalog/snapshot.ts`, `tools/`), `packages/servers/mssql-mcp/src/dialect/introspect.ts`
**Öncesi:** [katalog-eksiklik-hatasi.md](katalog-eksiklik-hatasi.md) — cursor orada bilerek ertelendi, burada tasarlanıyor

## Problem

`list_tables` ad listesi döndürüyor. Ad listesi, adı bilmeyen için işe yaramıyor.

Agent "tedarikçi tablosu hangisi" sorusuna ancak sayfa gezerek cevap verebiliyor, ve aranan kavram çoğu zaman tablo adında değil kolon adında yaşıyor (`VendorId`, `TedarikciKodu`) — kolon adları ise `describe_table` çağrılana kadar tamamen görünmez.

`search_catalog` katalogu bir kez okuyup ters indekse çeviriyor. Boş sorgu sayfalı gezinti kolu olduğu için `list_tables`'ın yaptığı her şeyi kapsıyor; o yüzden `list_tables` kaldırıldı.

## İndeks bütünlük sözleşmesi

> **İndeks, katalog sırasının bir ön ekini kapsar ve içindeki her nesne eksiksizdir.**

Bu kuralın sebebi, kısmi bir indeksin kesilmiş bir listeden **daha tehlikeli** olması.

8 000 tablolu bir ERP, 50 000 satırlık kolon tavanı, ~19 kolon ortalaması: okuma şema/ad sırasında gittiği için kabaca A–M indekste, N–Z hiç yok.

```text
search_catalog("invoice")  → dbo.INV_Invoices        (I, okunmuş)
search_catalog("vendor")   → 0 sonuç
agent → "Bu veritabanında tedarikçi tablosu yok."
```

`dbo.VND_Vendors` var, okunmadı. Kesilmiş bir liste **kısmi görünür** — 50 satır vardır, devamı olabileceği okunur. Boş sonuç ise **kesin bir olumsuz cevap gibi okunur**: sıfır sonuç = "yok" doğal okumadır.

İkinci biçim daha sinsi: tavan bir tablonun ortasında keserse o tablo indekstedir ama kolonlarının yarısıyla. Bir kolon adı araması sıfır döner, aynı tablo başka bir aramada listelenir; agent tutarsız bir dünya görür.

Üç kural sözleşmeyi üretiyor:

1. **Kesme daima nesne sınırında.** Kolon okuması kesildiyse son nesnenin kolonları tamamen atılır ve o nesne indekse hiç girmez. Yarım nesne yoktur.
2. **Sınır iki okumanın küçüğü.** Nesne okuması 5 000'de, kolon okuması 2 600 nesneye denk gelen satırda kesildiyse sınır 2 600'dür.
3. **Kısmilik her yanıtta ilan edilir**, yalnızca kurulumda değil — agent kurulumu görmüyor.

Kısmi indekste boş sonuç, tam indekstekinden ayırt edilebilir:

```json
{
  "results": [],
  "catalog": {
    "indexedObjects": 2600,
    "complete": false,
    "coverageEndsAt": "dbo.M_Rates",
    "indexedAt": "2026-09-22T09:14:03.118Z",
    "ageMs": 41200
  },
  "hint": "The index covers 2600 objects in catalog order and stops at dbo.M_Rates; a name after that point is not searchable."
}
```

Tam indekste aynı boş sonuç `complete: true` taşır ve hint yoktur — orada "yok" gerçekten "yok" demektir.

Bu, aynı hata sınıfının üçüncü örneği (`list_tables` sayısı, `describe_table` kolonları ve anahtarları, şimdi indeks), o yüzden kural olarak yazıldı: **eksik cevap kendini eksik ilan eder.**

## Tokenizer

`fold()` → alfanümerik olmayanda ayır → camelCase sınırında ayır → **bölünmemiş bütün token'ı da tut**.

| Girdi          | Token                          |
| -------------- | ------------------------------ |
| `CREATEDBY_ID` | `createdby`, `id`              |
| `CreatedBy`    | `createdby`, `created`, `by`   |
| `MüşteriAdı`   | `musteriadi`, `musteri`, `adi` |

Bütün token'ı tutmak zorunlu: `CREATEDBY` bölünemez, `CreatedBy` bölünür. İkisi de `createdby` terimini taşımazsa aynı kavram, adlandırma stiline göre farklı terimlere düşer.

**Önek eşleşmesi zorunlu.** Tamamen büyük harf bileşikler sınır taşımadığı için `create` sorgusunun `CREATEDBY_ID`'yi bulmasının tek yolu önek.

### Türkçe — ölçüldü

`fold()` dört I biçimini de `i`'ye indiriyor ve diyakritikleri ASCII tabanına düşürüyor:

```text
"İl" → "il"    "Il" → "il"    "il" → "il"    "ıl" → "il"
"MüşteriAdı" → "musteriadi"       "Müşteri" → "musteri"
"ÇağrıNo"    → "cagrino"          "ĞÜŞİÖÇ"  → "gusioc"
```

Yani ASCII klavyeyle yazılmış `MUSTERI` sorgusu `MüşteriAdı` kolonunu buluyor, tersi de.

Elimizdeki örnek veritabanında Türkçe karakter sayısı sıfır. Bu, yolun gereksiz olduğunu değil, o dağıtımda tetiklenmediğini gösterir — taşıyıcı kural şu: **ölçüm neyin çalışması gerektiğini söyler, neyin atlanabileceğini söylemez.** Aynı gerekçe, örnek katalogdaki önek dağılımı ve adlandırma stili oranları için de geçerli: tokenizer iki stili de, hangi oranda görülürse görülsün karşılar.

## Sıralama — IDF, BM25 değil

```text
score = Σ_terim  IDF(terim) × alanAğırlığı × eşleşmeKalitesi
IDF(t) = ln(1 + N / df(t))
eşleşmeKalitesi: tam terim 1.0, önek 0.5
```

Doküman = bir nesne; terimleri şema, ad, tüm kolon adları ve açıklamalar.

`k1`/`b` yok. 1–4 token'lık tanımlayıcılarda terim frekansı neredeyse hep 1, uzunluk normalizasyonu ayırt etmiyor. IDF ayırt ediyor — örnek katalogda ölçüldü:

| terim     | IDF  |
| --------- | ---- |
| `id`      | 0.70 |
| `date`    | 0.71 |
| `sys`     | 0.89 |
| `created` | 4.49 |
| `survey`  | 5.04 |
| `fuel`    | 5.33 |

**Stopword listesi yok** — IDF onu türetiyor, ve sabit bir liste bir dağıtımda gürültü olan kelimeyi başka dağıtımda ayırt edici olmaktan çıkarır.

**Açıklamalar TF taşımıyor.** Bir cümlede terimin iki kez geçmesi iki kat kanıt değil; her terim alan başına bir kez sayılır. Serbest metin alanına rağmen `k1`/`b`'ye ihtiyaç duymamamızın sebebi bu. Uzun açıklamaların sıralamayı bastırdığı ölçülürse eklenecek düğme uzunluk sönümü — o güne kadar yazılmıyor.

Alan ağırlıkları başlangıç değerleri, ölçülmüş değil: `name` 3, `description` 2, `column` 1, `columnDescription` 1, `schema` 1.

## İki okuma, tek okuma değil

Nesneler ve kolonlar ayrı sorularla okunuyor. Tek denormalize sorguda nesne açıklaması her kolon satırında tekrar ederdi: 11 518 satır × 512 karakter ≈ 5,9 MB saf tekrar.

İki okuma arası sapma (aradaki DDL) iki kuralla kapanıyor: nesne okumasında olmayan bir kolon satırı düşer; kolon okumasında olmayan bir nesne adlarıyla indekslenir.

## Bellek

Açıklama metni **yalnızca nesneler için** saklanıyor (≤ 5 000 × 160 ≈ 800 KB). Kolon açıklamaları indeksleniyor ama metinleri tutulmuyor; eşleşme `{ field: "columnDescription", value: <kolon adı> }` olarak bildiriliyor. Aksi halde tavan 55 000 × 160 ≈ 8,8 MB olurdu.

Ters indeksin kendi maliyeti küçük: örnek katalogda 1 626 terim, 15 315 posting, ~183 KB. Gerçek maliyet katalog okuması — ölçüldü, 512–863 ms ve 897 KB — ve TTL'in sebebi bu.

## Cursor

Pozisyon tek alan: sıralanmış aday listesindeki indeks. Parmak izi `fingerprintFromDigest(katalog, indeksÖzeti, variant)`; `variant` sıralanmış arama argümanları.

Buradan iki güvence çıkıyor: indeks yeniden kurulduysa parmak izi tutmaz (`stale_cursor`), aynı cursor farklı bir sorguyla gelirse variant tutmaz (yine `stale_cursor`). Pozisyonun sorguyu ayrıca taşımasına gerek yok.

**İndeks, son okunan değil son _gönderilen_ adayın bir sonrasını işaret eder.** Sayfa bütçesi 50 yerine 31'de kesebilir; cursor 50'den devam ederse aradaki 19 nesne sessizce kaybolur. Dış incelemenin doğru teşhisiydi.

## Ölçüm — 614 nesneli gerçek katalog

`SystemSoft_CRM_TEST`, iki okuma, canlı MCP zarfı üzerinden:

```text
ilk çağrı (indeks kurulumu dahil)   489 ms
ikinci çağrı (önbellekten)            1 ms
nesne 614   kolon 11 518
terim 2 156   posting 25 068   ~301 KB
```

Terim ve posting sayısı önceki tahminin (1 626 / 15 315 / ~183 KB) üstünde, çünkü tokenizer artık bölünmemiş token'ı da tutuyor. İki ayrı okuma, eski tek tam okumanın ölçülen 512–863 ms'inin altında kaldı.

Sıralama alan ağırlığını gerçek veride ayırt ediyor:

```text
"fuel"    SYS_SERVICE_FUEL_TYPES 21.31   SYS_SERVICE_REQUESTS 5.33   SYS_SERVICE_VEHICLES 5.33
"survey"  SYS_SurveyAnswers 29.79        SYS_SurveyOptions 29.79     SYS_SurveyQuestions 29.79
```

İlkinde ad eşleşmesi, diğer ikisinde yalnızca kolon eşleşmesi var; ağırlık dördün birine düşürüyor.

### Önek kuralının gerçek veride kanıtı

`"fatura"` sorgusu `SYS_TESTCARILERTABLOSU`'yu buluyor. Eşleşen kolon `FATURATARIH` — tamamen büyük harf, bölünecek sınır yok, yani ürettiği tek terim `faturatarih`. Bu tabloya ulaşmanın tek yolu önek.

Bu, planı yazarken varsayım olan kuralın ölçülmüş hali, ve tesadüfen Türkçe: **diyakritik sayısı sıfır ama Türkçe kelime var.** İkisi aynı şey değil, ve örnek veritabanı hakkında "Türkçe yok" demek ikincisini görmezden gelmekti.

**Kuralın sınırı da ölçüldü:** `"tarih"` sorgusu `FATURATARIH`'i **bulmuyor** — önek bölünemeyen bileşiğin başını karşılıyor, sonunu değil. (Başka bir tabloyu buluyor, çünkü orada `TARIH` ayrılabilir bir token.) Sonek ya da alt dizi eşleşmesi bu boşluğu kapatırdı; ölçülen maliyeti değerlendirilmeden eklenmiyor.

### Kısmi indeks sözleşmesi, gerçek katalogda

Tavan 4 000 kolona indirilip aynı veritabanına koşuldu:

```text
indekslenen nesne 211   kolon 3 993   (tavan 4 000)
sınır  dbo.SYS_CustomReportWebServiceUsers   17 kolonunun hepsi indekste
"survey" → 0 sonuç,  catalog.complete: false,  kapsamın bittiği yeri adlandıran hint
```

Sınırdaki nesne yarım değil tam — kuralın birinci maddesi. `SYS_SurveyAnswers` alfabetik olarak sınırın ötesinde kaldığı için bulunamıyor, ama yanıt bunu "yok" diye sunmuyor: aynı sorgu tam indekste hint'siz ve `complete: true` dönüyor.

### Açıklama yolu — geçici bir tabloyla doğrulandı

Bu katalogda `MS_Description` taşıyan nesne sayısı **sıfır**. Join'in 0 satır döndürmesi "join doğru, veri yok" ile "join bozuk"u ayırt etmiyordu, yani yazılmış ama yanlışlanamaz durumdaydı.

Test veritabanında geçici bir tablo kurulup ölçüldü ve silindi (mevcut hiçbir nesneye dokunulmadan):

```text
nesne açıklaması   "Tedarikci fatura mutabakat kayitlari"
kolon açıklaması   ZZQ1 → null,  ZZQ2 → "Musteri vergi numarasi"

"mutabakat"        field=description        value=<açıklama metni>
"vergi numarasi"   field=columnDescription  value=ZZQ2
yanıtta            description alanı açıklamayı taşıyor
```

Belirleyici satır `ZZQ1 → null`. Yüklem yanlış olsaydı (`minor_id` eksik ya da `class` yanlış) tablo açıklaması **bütün kolonlara yayılırdı**; sıfır satır dönen bir join bunu asla göstermezdi.

`columnDescription` eşleşmesinin `value`'su kolon adı, açıklama metni değil — tasarım gereği, kolon açıklamaları indekslenip metinleri saklanmıyor.

## Kapsam dışı

- **Kolon düzeyinde sonuç satırı** — 11,5 bin kolonlu bir katalogda tek terim yüzlerce kolon sonucu üretip tablo sonuçlarını bastırır, ve sıralama iki farklı birimi kıyaslamak zorunda kalır. Kolon eşleşmesi `matched[]` içinde zaten görünüyor.
- **Eş anlamlı / çok dilli sözlük** — ayrı problem, indeks yüzeyi değişmeden sonra eklenebilir.
- **Satır sayısı ve istatistik bilgisi** — farklı izin yüzeyi, ayrı karar.
- **Kalıcı indeks** — süreç ömrü boyunca bellekte yeterli; kalıcılık geçersizleştirme problemi doğurur.
