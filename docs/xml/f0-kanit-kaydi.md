# F0 kanıt kaydı

Durum: **F0-01–09 tamamlandı.** Platform CI kanıtı alındı: [run 34289898377](https://github.com/kaannakiin/sk4doosh-mcp/actions/runs/34289898377), commit `6bc8486`, beş hedef × Node 22/24 = **10/10 ayak, 80/80 kayıt pass, hiçbiri inconclusive değil.**

Deney harness'ı [`packages/xml-lab`](../../packages/xml-lab/). Repo'da duran [`docs/xml/f0/`](f0/) kayıtları yerel bir tekrar üretimdir; **kapının kanıtı yukarıdaki CI koşusunun artifact'larıdır.** Bu belgede JSON'da bulunmayan hiçbir sayı geçmez; platformlar arası değerler aralık olarak verilir.

## Ortam

| Alan                   | Değer                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| Host                   | darwin arm64, 10 çekirdek, 16 GiB                                 |
| Node                   | v24.12.0                                                          |
| Motor                  | `libxml2-wasm@0.7.2`, gömülü libxml2 2.15.1                       |
| Sertleştirilmiş bayrak | `XML_PARSE_NO_XXE \| XML_PARSE_NONET \| XML_PARSE_NO_SYS_CATALOG` |
| `maxRSS` birimi        | KiB (ölçümle çözüldü, devralınmadı)                               |

CI on ayağın tamamında `collect-evidence.mjs` koştu; gömülü libxml2 sürümü (`2.15.1`) ve provenance commit'i (`6e4dc82a`) on ayakta da aynı çıktı.

## Görev tablosu

Sonuçlar on CI ayağının tamamı içindir.

| Görev | Sonuç    | Kritik gözlem (platformlar arası)                                                      |
| ----- | -------- | -------------------------------------------------------------------------------------- |
| F0-01 | pass     | Artifact `6e4dc82a`'dan; gömülü libxml2 `2.15.1`; [karar eki](bagimlilik-karar-eki.md) |
| F0-02 | pass     | fd 1 temiz, bozuk belgede fd 2'ye de 0 byte; cold import p95 19,183–51,673 ms          |
| F0-03 | pass     | Çarpım matrisinde sıfır URI sızıntısı; dört skaler tip kimliğini koruyor               |
| F0-04 | pass     | **Sessiz bozulma sıfır**, on ayakta da                                                 |
| F0-05 | pass     | Aday C `0fp/0fn`, aday A `3fp/1fn`; pozitif kontrol her ayakta ateşledi                |
| F0-06 | pass     | Durma oranı 1314,8–4163,3 (iki ayakta sonsuz); negatif kontrol her ayakta kurdu        |
| F0-07 | pass     | `diag` tier-1 her yolda 0 canlı; geri kazanım oranı −0,0032…0                          |
| F0-08 | pass     | 8 MiB on ayakta da geçti; **10/10 kesin ölçüm**, inconclusive yok                      |
| F0-09 | bu belge | Kabul; K1 korunuyor                                                                    |

## Tekrar üretme

```
pnpm turbo run test --filter=@sk-mcp/xml-lab --force
SKMCP_XML_BENCH=1 node packages/xml-lab/collect-evidence.mjs
```

`SKMCP_XML_BENCH=1` verilmezse yalnız 1 MiB kademesi ölçülür ve dosya limiti kararı açık kalır. `SKMCP_XML_F0_NO_NETWORK=1` F0-02'yi atlar ve kayıtta `not run` olarak işaretler — asla `pass` değil.

## Pozitif kontroller

Ateşleyemeyen bir dedektör kanıt değildir. Üçü de on ayağın tamamında ateşledi:

| Kontrol                         | Beklenen           | On ayaktaki sonuç                |
| ------------------------------- | ------------------ | -------------------------------- |
| F0-05 `arm3_register_providers` | Canary'ye ulaşmalı | `providerConsulted: true`, 10/10 |
| F0-06 `e06-05b` (terminate yok) | CPU meşgul kalmalı | `baseline: true`, 10/10          |
| F0-07 `e07-00` (kasıtlı leak)   | Tier-1 görmeli     | canlı sayı 0 → 40, 10/10         |

**Windows'ta pozitif kontrol daha zayıf.** `arm3` iki seviyeye ayrıldı ve seviyeler platforma göre değişiyor:

| Platform      | Sağlayıcıya danışıldı | Canary içeriği belgeye ulaştı |
| ------------- | --------------------- | ----------------------------- |
| linux, darwin | evet                  | **evet**                      |
| win32         | evet                  | **hayır**                     |

Windows'ta `fsExistsSync` ateşliyor ama dosya hiç açılmıyor. Dolayısıyla o platformda negatif kolların sıfır sonucu _"sağlayıcıya hiç danışılmadı"_ iddiasını destekler, _"içerik sızması tespit edilebilirdi"_ iddiasını **desteklemez**. İki Windows ayağı bunu kendi kayıtlarına limit satırı olarak yazıyor.

Dördüncü bir kontrol **negatif** sonuç verdi ve bu da on ayakta tutarlı: F0-07 tier-2 istatistiksel katmanı 220 belgelik kasıtlı bir leak'i **hiçbir ayakta yakalayamadı** (`tier2DetectedIt: false`, 10/10). Allocator gürültüsü sinyalin üstünde. **Bellek kapısı tier-1 `diag` oracle'ıdır; RSS istatistikleri kanıt ağırlığı taşımaz** ve yalnız kayıt amaçlı tutulur.

## Çıkış kapısının dört bloğu

| Blok                        | Sonuç          | Dayanak (on ayak)                                                                        |
| --------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| Dış I/O kapatılamıyorsa     | **Kapalı**     | arm1/2/4/5 bütün dedektörlerde sıfır; arm3 aynı canary'yi her ayakta ateşliyor           |
| Encoding sessiz bozuluyorsa | **Bozulmuyor** | `silentCorruptionRows` on ayakta da boş                                                  |
| Disposal/iptal güvenilmezse | **Güvenilir**  | Durma oranı en düşük ayakta bile 1314,8 (eşik 10); `diag` her yolda 0 canlı, GC sayacı 0 |
| WASM dağıtımı çalışmıyorsa  | **Çalışıyor**  | `--ignore-scripts` kurulumu on ayakta çalıştı; fd 1 ve fd 2 temiz                        |

## Türetilmiş bütçeler

`tool-sozlesmesi.md`'deki başlangıç değerleri ölçüm hedefiydi. Türetim kuralı **en yavaş kesin ölçüm veren ayaktır**; on ayağın onu da kesin ölçtü, en yavaşı `darwin-x64` Node 22 (toplam p95 523,311 ms).

| Kaynak             | Başlangıç önerisi | Ölçülen sonuç       | Not                                                                                                            |
| ------------------ | ----------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| DOM'a alınan dosya | 8 MiB             | **8 MiB korunuyor** | On ayakta da üç şekil geçti (`measuredUpToMiB: 8`)                                                             |
| Parse/sorgu süresi | 2 s               | **2 s doğrulandı**  | 3 × 523,311 ms → 2000 ms; hızlı hostlarda 500 ms çıkıyordu                                                     |
| Etkin worker       | 1                 | **1**               | Değişmedi                                                                                                      |
| Kuyruk             | en fazla 4        | **5**               | En yavaş hostta istemci sabri (10 s / 2 s) bağlıyor; hızlı hostlarda 8 ve sınırlayan pinlenen snapshot belleği |
| DOM derinliği      | 128               | **128 korunuyor**   | Motor on ayakta da 256'da parse ediyor, 1024'te reddediyor                                                     |
| Sayfa              | 50 / 200          | Ölçülmedi           | Yanıt zarfı F2-08'e ait                                                                                        |

**Yerel ölçüm yanıltıcıydı ve bu türetim kuralının neden var olduğunu gösteriyor.** Kendi makinemde süre bütçesi 500 ms çıkıyordu ve "hedeflenenin dörtte biri" diye kaydedilmişti. En yavaş desteklenen host 523 ms p95 verince bütçe 2000 ms'e çıktı — yani `tool-sozlesmesi.md`'nin başlangıçtaki 2 s önerisi doğruymuş. Tek host ölçümüyle yayınlansaydı bütçe dört kat dar olacaktı.

Kuyruk derinliği iki bağımsız kısıtın küçüğü olduğu için host'a göre değişiyor: yavaş hostta süre bütçesi büyüdüğü için istemci sabri bağlıyor (5), hızlı hostta ana süreçte pinlenen `B_q × B_f` byte bağlıyor (8). Yayınlanacak değer **5**.

Cold start: modül import p95 on ayakta 19,183–51,673 ms. 300 ms eşiğinin altında olduğu için **ön ısıtma gerekmiyor**.

Süreç tepe RSS'i 9 hücrelik matris için 239.568–275.024 KiB aralığında.

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

İlk CI koşusu 10/10 geçti; ikincisi `darwin-x64` Node 24'te kırmızıydı. Sebep motor değildi: o runner'da hiçbir boyut kademesi üç şekilde birden kararlı ölçülemedi. Harness bunu `fail` diye raporluyordu, yani "ölçemedik" ile "motor bütçeyi tutturamadı" aynı kovaya düşüyordu.

Ölçüm kapıları mutlak eşiklerden sağlam istatistiklere çevrildi; hiçbirinde eşik gevşetilmedi, ölçütün şekli değişti.

| Risk               | Eski ölçüt                   | Yeni ölçüt                                                  | On ayaktaki değer |
| ------------------ | ---------------------------- | ----------------------------------------------------------- | ----------------- |
| F0-08 kararlılığı  | CV ≤ 0,30, her hücre geçmeli | Relative MAD ≤ 0,15; kararsız hücre isimlendirilip dışlanır | 10/10 kesin ölçüm |
| F0-06 CPU oracle   | Mutlak `busyFraction < 0,05` | İki kolun **oranı** ≥ 10                                    | 1314,8–4163,3     |
| F0-07 geri kazanım | Ortalama, 3 döngü            | Medyan, 8 serpiştirilmiş döngü                              | −0,0032…0         |

Ortalamadan medyana ve CV'den MAD'a geçişin gerekçesi aynı: tek bir aykırı örnek ortalama tabanlı istatistiği sürüklüyordu. CPU oracle'ının orana çevrilmesi ölçütü host hızından bağımsız kılar — yavaş bir runner'da mutlak kesir düşer, oran korunur.

**Ölçülemezlik artık ayrı bir sonuç.** F0-08 kararlı kademe bulamazsa `inconclusive` raporluyor ve bütçe türetimine girmiyor. Bunu yalnız F0-08 yapabilir; F0-05, F0-06 ve F0-07 hâlâ `pass` şart koşuyor, çünkü kendi dedektörünü kanıtlayamayan bir güvenlik kapısı yeşile geçmemeli.

Üçüncü koşuda `darwin-x64` Node 22 tek bir hücreyi (`text-4mib`) kararsız işaretleyip dışladı ve yine de kesin ölçüm verdi — mekanizma tasarlandığı gibi çalıştı.

İkinci koşuda ayrıca düşen ayağın hiç artifact üretmediği görüldü: `collect-evidence` test adımından sonraydı ve test düşünce hiç koşmadı. Teşhise en çok ihtiyaç duyulan ayak geriye kanıt bırakmıyordu. Kanıt toplama ve yükleme artık `if: always()` ile çalışıyor.

## Kabul edilen sınırlar

1. **Gömülü libxml2 sürümü yalnız `upstream-pin` ile belirlendi** ve kaynak upstream değil `jameslan/libxml2` fork'udur. Ayrıntı [karar ekinde](bagimlilik-karar-eki.md).
2. **`XML_PARSE_NONET` no-op olabilir.** libxml2 2.15 nanohttp'yi kaldırdı; ağ canary'sinin sıfır hit'i aşırı-belirlenmiştir ve ek güvence sayılmaz.
3. **Windows'ta pozitif kontrol yalnız sağlayıcı-danışma seviyesinde ateşliyor** (yukarıda ölçüldü). O platformda içerik sızması tespit edilebilirliği kanıtlanmadı.
4. **Tier-2 bellek istatistiği hiçbir ayakta ayırt edici değil.** Bellek kapısı `diag`'dır.
5. **Dosya canary'si** okumanın denenip atıldığını kanıtlamaz; yalnız içeriğin belgeye veya hataya sızmadığını gösterir.
6. **Sayfa/yanıt zarfı bütçesi ölçülmedi**; F2-08'e aittir.
7. **Derinlik merdiveni parse sonucunu ölçer.** `read_node` görünüm limiti ayrı katmandır ve F2-06'da ölçülür.
8. **Bütçeler bu on runner'ın ölçümüdür.** Daha yavaş bir dağıtım hedefi eklenirse `B_t` yeniden türetilmelidir.

## Karar (F0-09)

**K1 korunuyor: `libxml2-wasm@0.7.2` kabul edildi.** Çıkış kapısının dört bloğu da beş hedef × Node 22/24 üzerinde kapandı; hiçbir güvenlik bayrağı bir ölçümü geçirmek için gevşetilmedi ve hiçbir eşik bir hücreyi geçirmek için yükseltilmedi.

Stack değişikliği gerekmediği için yeni bir global ADR açılmadı; sürüm, bütünlük ve lisans kaydı [K1](kararlar.md) üzerinden [karar ekine](bagimlilik-karar-eki.md) bağlandı.

Motor sürümü yükseldiğinde veya yeni bir dağıtım hedefi eklendiğinde bu matris yeniden koşulur; harness bunun için kalıcıdır ve alternatif motorlar aynı fixture'lardan geçirilebilir.

## Bu fazın kapsamı dışı

F0'ın işi F0-01–09'du ve bitti. Aşağıdakiler bu belgenin görevleri değildir, yalnız F0'ın hangi kararı hangi faza bıraktığını gösterir:

| Nerede                                     | Ne                                                                                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [F1](fazlar/01-ortak-cekirdek-ve-excel.md) | F1-03 worker kaynak sahipliğinin uygulaması; tasarım kararı F0-07 ile verildi ve `file-core` disposal hook'u gerekmiyor. F1-05'in XML yanıt bütçesi, F1-06'nın XML tüketici entegrasyonu |
| [F2](fazlar/02-okuma-mvp.md)               | Dört tool; sayfa ve yanıt zarfı bütçesi F2-08'de ölçülür                                                                                                                                 |
| [tool sözleşmesi](tool-sozlesmesi.md)      | Türetilmiş bütçeler oraya işlendi                                                                                                                                                        |
