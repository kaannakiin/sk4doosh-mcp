# F0 kanıt kaydı

Durum: F0-01–09 için **yerel kanıt üretildi; platform CI kanıtı bekliyor.** Hiçbir görev henüz `tamamlandı` değildir — README yönetim kuralı: _"Durum yalnızca kanıt bağlantısıyla `tamamlandı` yapılır. Yerel başarı, platform CI başarısı yerine geçmez."_

Deney harness'ı [`packages/xml-lab`](../../packages/xml-lab/). Makine okunur kayıtlar [`docs/xml/f0/`](f0/) altında. **Bu belgede JSON'da bulunmayan hiçbir sayı geçmez.**

## Ortam

| Alan                   | Değer                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| Host                   | darwin arm64, 10 çekirdek, 16 GiB                                 |
| Node                   | v24.12.0                                                          |
| Motor                  | `libxml2-wasm@0.7.2`, gömülü libxml2 2.15.1                       |
| Sertleştirilmiş bayrak | `XML_PARSE_NO_XXE \| XML_PARSE_NONET \| XML_PARSE_NO_SYS_CATALOG` |
| `maxRSS` birimi        | KiB (ölçümle çözüldü, devralınmadı)                               |

**Node 22 ayağı yerelde koşulmadı.** F0-02'nin "Node 22/24" ölçütü ancak CI iki major'ı da kaydettiğinde kapanır.

## Görev tablosu

| Görev | Sonuç      | Kayıt                                                                             | Kritik gözlem                                                            |
| ----- | ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| F0-01 | pass 49/49 | [f0-01-surface.json](f0/f0-01-surface.json), [karar eki](bagimlilik-karar-eki.md) | Artifact `6e4dc82a` commit'inden; incelenen `3944879` değil              |
| F0-02 | pass 10/10 | [f0-02-consumer.json](f0/f0-02-consumer.json)                                     | fd 1 temiz; WASM pack içinden; cold import p95 14,101 ms                 |
| F0-03 | pass 57/57 | [f0-03-semantics.json](f0/f0-03-semantics.json)                                   | Çarpım matrisinde sıfır URI sızıntısı; dört skaler tip kimliğini koruyor |
| F0-04 | pass 31/31 | [f0-04-encoding-matrix.json](f0/f0-04-encoding-matrix.json)                       | Sıfır sessiz bozulma; 15 satır açık hatayla reddedildi                   |
| F0-05 | pass 14/14 | [f0-05-security.json](f0/f0-05-security.json)                                     | arm3 pozitif kontrolü ateşledi; aday C ve D `fp=0 fn=0`                  |
| F0-06 | pass 13/13 | [f0-06-worker.json](f0/f0-06-worker.json)                                         | terminate/edilmeyen CPU durma oranı 4934,6 (eşik 10)                     |
| F0-07 | pass 15/15 | [f0-07-lifetime.json](f0/f0-07-lifetime.json)                                     | `diag` tier-1 ikili oracle; tier-2 bu host'ta ayırt edici **değil**      |
| F0-08 | pass 5/5   | [f0-08-measurements.json](f0/f0-08-measurements.json)                             | 8 MiB üç şekilde de geçti; bütçeler türetildi                            |
| F0-09 | bu belge   | —                                                                                 | Kabul; K1 korunuyor                                                      |

## Tekrar üretme

```
pnpm turbo run test --filter=@sk-mcp/xml-lab --force
SKMCP_XML_BENCH=1 node packages/xml-lab/collect-evidence.mjs
```

`SKMCP_XML_BENCH=1` verilmezse yalnız 1 MiB kademesi ölçülür ve dosya limiti kararı açık kalır. `SKMCP_XML_F0_NO_NETWORK=1` F0-02'yi atlar ve kayıtta `not run` olarak işaretler — asla `pass` değil.

## Pozitif kontroller

Ateşleyemeyen bir dedektör kanıt değildir. Üçü de ateşledi:

| Kontrol                         | Beklenen           | Ölçülen                              |
| ------------------------------- | ------------------ | ------------------------------------ |
| F0-05 `arm3_register_providers` | Canary'ye ulaşmalı | `tokenSeen: true`, `fsExistsSync: 4` |
| F0-06 `e06-05b` (terminate yok) | CPU meşgul kalmalı | `busyFraction 0,982`                 |
| F0-07 `e07-00` (kasıtlı leak)   | Tier-1 görmeli     | 0 → 40 canlı instance                |

Dördüncü bir kontrol **negatif** sonuç verdi ve bu da kayda geçti: F0-07 tier-2 istatistiksel katmanı 220 belgelik kasıtlı bir leak'i **yakalayamadı** (`tier2DetectedIt: false`). Allocator gürültüsü (medyan kayma 6–22 MiB) sinyalin üstünde. Bu nedenle **bellek kapısı tier-1 `diag` oracle'ıdır; RSS istatistikleri bu host'ta kanıt ağırlığı taşımaz** ve yalnız kayıt amaçlı tutulur.

## Çıkış kapısının dört bloğu

| Blok                        | Sonuç          | Dayanak                                                                                               |
| --------------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| Dış I/O kapatılamıyorsa     | **Kapalı**     | arm1/2/4/5 bütün dedektörlerde sıfır; arm3 aynı canary'yi ateşliyor, yani sıfırlar anlamlı            |
| Encoding sessiz bozuluyorsa | **Bozulmuyor** | 31 satırın hiçbirinde `silentCorruption`; `enc-lie-1254-says-utf8` reddedildi                         |
| Disposal/iptal güvenilmezse | **Güvenilir**  | terminate senkron WASM'ı kesiyor (durma oranı 4934,6); `diag` her yolda 0 canlı, `garbageCollected` 0 |
| WASM dağıtımı çalışmıyorsa  | **Çalışıyor**  | `--ignore-scripts` kurulumu çalışıyor; WASM pack içinde gömülü; fd 1 temiz                            |

## Türetilmiş bütçeler

`tool-sozlesmesi.md`'deki başlangıç değerleri ölçüm hedefiydi. Ölçülen karşılıkları:

| Kaynak             | Başlangıç önerisi | Ölçülen sonuç                                | Not                                                                      |
| ------------------ | ----------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| DOM'a alınan dosya | 8 MiB             | **8 MiB korunuyor**                          | En kötü şekil toplam p95 82,639 ms                                       |
| Parse/sorgu süresi | 2 s               | **0,5 s**                                    | 3 × en kötü p95, 500 ms tabanına yuvarlandı                              |
| Etkin worker       | 1                 | **1**                                        | Değişmedi                                                                |
| Kuyruk             | en fazla 4        | **8**, sınırlayan: pinlenen snapshot belleği | İstemci sabri 20'ye izin veriyordu; 64 MiB ana süreç bütçesi 8'e indirdi |
| DOM derinliği      | 128               | **128 korunuyor**                            | Motor 256'da parse ediyor, 1024'te reddediyor; 128 önce bağlıyor         |
| Sayfa              | 50 / 200          | Ölçülmedi                                    | Yanıt zarfı F2-08'e ait                                                  |

Süre bütçesi hedeflenenin **dörtte biri** çıktı; bu bir gevşetme değil, ölçümün hedeften iyi olması. Kuyruk derinliği ise iki bağımsız kısıtın küçüğüdür ve bağlayıcı olan istemci sabri değil, ana süreçte pinlenen `B_q × B_f` byte'tır.

Cold start: modül import p95 14,101 ms, ilk parse p95 1,595 ms. 300 ms eşiğinin çok altında olduğu için **ön ısıtma gerekmiyor** ve cold start süre bütçesine katlanabilir.

Süreç tepe RSS'i tüm 9 hücrelik matris için 256.096 KiB. Hücre başına marjinal RSS ısınmadan sonra sıfıra yakındır; WASM heap high-water'ı ısınma sırasında kurulur, bu yüzden tek sayı olarak tepe RSS kullanılır.

## DOCTYPE dedektörü

| Aday                                   | tp  | tn  | fp  | fn  |
| -------------------------------------- | --- | --- | --- | --- |
| A — UTF-8 string regex                 | 9   | 6   | 3   | 1   |
| B — ham byte regex                     | 9   | 6   | 3   | 1   |
| C — encoding-farkında prolog tokenizer | 10  | 9   | 0   | 0   |
| D — post-parse `doc.dtd`               | 10  | 9   | 0   | 0   |

A ve B aynı dört satırda düşüyor: `doctype-utf16le-real` (false negative — gerçekten tehlikeli belgeyi ıskalıyor) ve yorum/CDATA/PI içindeki metinde false positive. _"Regex ile byte taraması tek XML güvenlik sınırı yapılmaz"_ iddiası böylece isim isim başarısız satırlarla **ölçülmüş sonuç** oldu.

Nihai politika **C ∧ D ∧ sertleştirilmiş bayraklar**. C'nin anahtar özelliği desen zekâsı değil yapısal olması: DOCTYPE yalnız prolog'da bulunabildiği için tarayıcı kök elementin start tag'inde durur, dolayısıyla CDATA ve attribute tuzakları hiç oluşmaz.

## Paylaşımlı runner'a karşı sertleştirme

Ölçüm kapıları mutlak eşiklerden sağlam istatistiklere çevrildi; hiçbirinde eşik gevşetilmedi, ölçütün şekli değişti.

| Risk               | Eski ölçüt                   | Yeni ölçüt                                                              | Yerel pay                       |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------- | ------------------------------- |
| F0-08 kararlılığı  | CV ≤ 0,30, her hücre geçmeli | Relative MAD ≤ 0,15; kararsız hücre isimlendirilip türetimden çıkarılır | En kötü hücre 0,02'de, 7,5× pay |
| F0-06 CPU oracle   | Mutlak `busyFraction < 0,05` | İki kolun oranı ≥ 10; negatif kontrol baseline kuramazsa `inconclusive` | Oran 4934,6, 490× pay           |
| F0-07 geri kazanım | Ortalama, 3 döngü            | Medyan, 8 serpiştirilmiş döngü; ayak izi ölçülemezse `inconclusive`     | Oran 0,000 (eşik 0,1)           |

CV'den MAD'a geçişin gerekçesi tek bir yavaş iterasyonun ortalama tabanlı dağılımı sürüklemesiydi — aynı gerekçe zaten Theil–Sen'in OLS yerine seçilmesinde kullanılmıştı. CPU oracle'ının orana çevrilmesi ölçütü host hızından bağımsız kılar: yavaş bir runner'da mutlak kesir düşer, oran korunur.

Bu koşuda mekanizma canlı çalıştı: `nodes-1mib` kararsız işaretlendi, adıyla kaydedildi ve türetimden çıkarıldı; bütçe 4 ve 8 MiB kademelerinden türetildi.

Kapanmayan risk: bu sertleştirmelerin CI runner'larında yeterli olduğu **ölçülmedi**. Yerel paylar geniş, ama gerçek kanıt ilk yeşil koşudur.

## Kabul edilen sınırlar

1. **Platform CI yok.** Bütün sayılar tek host, tek Node sürümü. Beş hedef × Node 22/24 çalıştırılmadan hiçbir görev `tamamlandı` olamaz.
2. **Gömülü libxml2 sürümü yalnız `upstream-pin` ile belirlendi** ve kaynak upstream değil `jameslan/libxml2` fork'udur. Ayrıntı [karar ekinde](bagimlilik-karar-eki.md).
3. **`XML_PARSE_NONET` no-op olabilir.** libxml2 2.15 nanohttp'yi kaldırdı; ağ canary'sinin sıfır hit'i aşırı-belirlenmiştir ve ek güvence sayılmaz.
4. **Tier-2 bellek istatistiği bu host'ta ayırt edici değil** (yukarıda ölçüldü). Bellek kapısı `diag`'dır.
5. **Dosya canary'si** okumanın denenip atıldığını kanıtlamaz; yalnız içeriğin belgeye/hataya sızmadığını gösterir.
6. **`collect-evidence.mjs` Node'un tip sıyırmasına dayanır** (≥22.18). Node 22 ayağında doğrulanmadı.
7. **Sayfa/yanıt bütçesi ölçülmedi**; F2-08'e ait.
8. **F0-08 derinlik merdiveni parse sonucunu ölçer.** `read_node` görünüm limiti ayrı katmandır ve F2-06'da ölçülür.

## Karar (F0-09)

**K1 korunuyor: `libxml2-wasm@0.7.2` kabul edildi.** Çıkış kapısının dört bloğu da kapandı; hiçbir güvenlik bayrağı bir ölçümü geçirmek için gevşetilmedi ve hiçbir eşik bir hücreyi geçirmek için yükseltilmedi.

Stack değişikliği gerekmediği için yeni bir global ADR açılmadı; sürüm, bütünlük ve lisans kaydı [K1](kararlar.md) üzerinden [karar ekine](bagimlilik-karar-eki.md) bağlandı.

Bu kabul **platform CI koşusuna kadar geçicidir.** CI beş hedef × Node 22/24'te aynı sonuçları vermezse karar yeniden açılır ve alternatif motorlar aynı fixture matrisiyle sınanır — harness bunun için kalıcıdır.
