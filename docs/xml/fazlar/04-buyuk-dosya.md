# F4 — Büyük dosya ve kayıt parçalama

Durum: **planlandı** (2026-09-10); isteğe bağlı değil. Sorumlu: XML performans
geliştiricisi. Kararlar [karar 019](../../kararlar/019-buyuk-dosya-ve-kademe.md)'dadır
ve bu belgenin ilk sürümündeki iki varsayımını değiştirir. Ölçüm dayanağı
[F2 kapanışı](../xml-f2-kapanis.md) (M15, M16) ve [F3 kapanışı](../xml-f3-kapanis.md)
(M23b).

Bu fazın ilk sürümü işi "isteğe bağlı" sayıyor ve önkoşul olarak "DOM sınırının gerçek
kullanımda yetersiz kaldığını gösteren kayıt" istiyordu. İki sebeple değişti. Birincisi,
`maxXmlBytes` 8 MiB'dir ve gerçek kullanıcı dosyaları bunun üstündedir. İkincisi ve
bağlayıcı olanı: [F6-08](06-yayin-ve-kabul.md)'in `file-core` `1.0` kararı bugün
`bytes`-only bir `ParseContext`'i dondurmak üzeredir; `readRange` sonradan eklenirse
breaking change olur. **F4-L6 o karardan önce inmek zorundadır.**

Yaklaşım streaming değil, kayıt sınırından parçalamadır; gerekçe
[K19-2](../../kararlar/019-buyuk-dosya-ve-kademe.md)'dedir. `libxml2` tek semantik
otorite kalır, tarayıcı yalnız byte konumu üretir.

## Hedef

Bütçe üstündeki **kayıt-şekilli** belgeden kontrollü erişim. Genel XPath'i parçaya
taşımak hedef değildir. Global işlemler açık `unsupported` döner
([K19-1](../../kararlar/019-buyuk-dosya-ve-kademe.md), K19-3).

## Kapı sırası

Her kapı bağımsız teslim edilebilir ve hiçbiri ölçülmemiş bir varsayıma bağlı değildir.

| Görev | İş                                                                                                                                        | Kabul ölçütü                                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F4-L0 | Ölçüm: hash throughput (8/50/256/1024 MiB), parça DOM residency katsayısı, sınır taraması hızı, **kullanıcı korpusu şekil anketi**        | Dört kayıt mevcut JSON şemasıyla `docs/xml/f0/`'a girer; relative MAD mevcut 0,15 tavanının altında. Korpus anketi olmadan F4-L4'ün değeri hipotezdir                                                                     |
| F4-L1 | `mode` her yanıt zarfında ve `list_documents`'ın her girdisinde; tek knob, türetilmiş kapasiteler; worker import sınırının genişletilmesi | Her yanıt `mode` taşır; `describe_document.limits` knob'u ve türetilenleri bildirir; `modeFor` toplam ve monoton; hiçbir input provider kaydedilmiyor testle sabit. Davranış değişmez, saf ek                             |
| F4-L2 | Sınır tarayıcısı saf fonksiyon olarak; üretime bağlanmaz                                                                                  | **Diferansiyel oracle**: her kayıt-şekilli fixture'da tarayıcının aralıkları tek tek parse edilince tam DOM'un sonucuyla aynı değer ve aynı `occurrence` dizisi. Beş düşmanca fixture geçer. UTF-16 açık kodla reddedilir |
| F4-L3 | Worker'da parça parse; tavan değişmez                                                                                                     | Zorlamalı parçalı anahtarla 8 MiB fixture, kalıcı yolun zarfıyla `mode`, `totalItemsExact` ve `nodeId` dışında derin eşit. Kayıt `occurrence` taşır, adres taşımaz                                                        |
| F4-L4 | 8 MiB → 50 MiB; C++ değişmez                                                                                                              | 40 MiB kayıt-şekilli fixture doğru cevaplanır; 40 MiB düzensiz ağaç `unsupported` + düzeltme önerisi; bütçeyi tek başına aşan kayıt açık hata; global işlemler `unsupported`, yaklaşık sonuç yok                          |
| F4-L5 | Byte ipuçlu cursor                                                                                                                        | Sayfa gecikmesi sayfa numarasından bağımsız; exactly-once korunur; sahte `b` fuzz'ı hiçbir zaman ipuçsuz yolun üretmeyeceği bir satır vermez                                                                              |
| F4-L6 | `file-core` kaynak sözleşmesi — **F6-08 öncesi son tarih**                                                                                | Public API aralık destekli kaynağı ifade edebiliyor; iki sunucu da derleniyor; dört paket yeşil; `bytes` bir minor boyunca uyumluluk yolu olarak duruyor                                                                  |
| F4-L7 | Tek native release: bütçe tavanı + `readRange` + `digest`                                                                                 | Beş platform × Node 22/24 yeşil; `readRange` değişen dosyada `read` ile aynı `file_changed` davranışını verir; `digest` tam dosya SHA-256'sına eşit; bütçe alanının genişliği assert edilir                               |
| F4-L8 | 1 GB                                                                                                                                      | 1 GB kayıt-şekilli fixture'da `describe_document` ve tam sayfalama yürüyüşü exactly-once ile tamamlanır, peak RSS ilan edilen bütçenin altında; 1 GB düzensiz ağaç `unsupported`                                          |
| F4-06 | Çoklu belge araması (`search_documents`)                                                                                                  | **Korundu, kapsamı değişmedi.** Bu kapı dizisinden bağımsızdır; sırası L8 sonrasıdır. Artımlı dosya keşfi + dosya başı ve toplam bütçe; unreadable/unsupported/değişen dosyalar ayrı sayaç                                |

## Eski görev kimliklerinin devri

Yönetim kuralı görev kimliklerini sabit tutar; aşağıdaki kimlikler kaybolmadı, yer
değiştirdi.

| Eski                                           | Nereye gitti                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F4-01 Kullanım ve bütçe kararı                 | F4-L0 ölçümü + [karar 019](../../kararlar/019-buyuk-dosya-ve-kademe.md). "Yalnız olası ihtiyaç için ikinci parser eklenmiyor" ölçütü K19-7'de `sax` reddi olarak karara bağlandı                 |
| F4-02 Streaming decoder/parser karşılaştırması | F4-L2. Karşılaştırma yapıldı ve sonuçlandı: `libxml2-wasm@0.7.2` push parser/SAX ihraç etmiyor, `sax` byte offseti üretmiyor ve değer üretiyor. In-house lexer                                   |
| F4-03 Desteklenen selector alt kümesi          | K19-1 ve K19-3. `unsupported` kümesi kararla sabitlendi                                                                                                                                          |
| F4-04 Tarama ve olası indeks bütçesi           | F4-L5 (tarama bütçesi) + F4-L8 (seyrek checkpoint indeksi). İndeks baştan kurulmaz                                                                                                               |
| F4-05 Devam ve kaynak değişimi                 | F4-L5 (cursor tarama konumuna bağlanır) + K19-9 (kimlik). "Karakter offseti byte offseti diye kullanılmaz" şartı F4-L2'nin UTF-16 reddine dönüştü                                                |
| F4-06 `search_documents`                       | Korundu, yukarıdaki tabloda                                                                                                                                                                      |
| F4-07 DOM/streaming parity                     | **Anlamını yitirdi**: parçalamada karşılaştırılacak ikinci motor yok. Yerine F4-L2'nin diferansiyel oracle'ı geçti; [test stratejisinde](../test-stratejisi.md) T20 buna göre yeniden tanımlandı |

## Devralınan sahipsiz iş

F2'nin 2. kalan sınırı ve F3'ün M23b ölçümü — derin belgelerde kayıt byte'ının adres
paylaşımıyla düşürülmesi — bu faza görev kimliği olmadan devredilmişti. **F4-L3'e
bağlandı.** Parçalı kademede kayıt zaten adres yerine `occurrence` taşıyor, yani iş
oraya doğal olarak ait ([K19-6](../../kararlar/019-buyuk-dosya-ve-kademe.md)).

## Neden 50 MiB, neden native release

50 MiB bir bellek sınırı değil, `file-core-native`'in C++'ında **derlenmiş bir
sabittir**. Bellek bağlayıcı değil: bugün 8 MiB'de worker ~96 MiB tutuyor, 50 MiB
parçalı okuma 8 MiB parça bütçesiyle ~146 MiB tutar — 6,25 kat dosya için ~1,5 kat
bellek.

Bu yüzden F4-L4 C++'a hiç dokunmadan tavanı 6,25 kat yükseltiyor ve yol haritasının en
iyi risk/değer oranını taşıyor. Sabiti aşmak beş platformluk prebuild turu istediği için
bütçe tavanı, `readRange` ve `digest` F4-L7'de **tek release'te** iner.

## Kesim güvenliğinin şartı

"Yanlış kesim gürültülü parse hatası verir" iddiası koşulludur. CDATA, comment, PI ve
attribute tırnağı doğru işlenmezse `<![CDATA[</entry><entry>]]>` gibi bir girdi
**iyi-biçimli ama yanlış** bir parça üretir; bu sessiz hatadır. Bu yüzden F4-L2'nin
kabul ölçütü birim testi değil diferansiyel oracle'dır ve bugün tümüyle ölçülebilir:
her fixture kalıcı kademeye sığıyor, iki yol yan yana koşturulabiliyor.

Kesimden geçirilecek bağlam: ancestor namespace bildirimleri, `xml:lang`, `xml:base`,
`xml:space` ve **byte** offseti. DOCTYPE tümden reddedildiği için entity sorunu yoktur.

## Kabul

`docs/xml/f0/` altına giren ölçüm kayıtları mevcut şemayı ve mevcut kararlılık
ölçütlerini karşılar; sample sayısı ve ortam belirtilir. Dev tek kaydın bütçeyi aşması
açık hata verir. Parçalama etiketi sınırsız dosya desteği anlamına gelmez: kayıt-şekilli
olmayan belge bütçe üstünde `unsupported` alır.

F4-L0'ın korpus anketi bu fazın en büyük ölçülmemiş varsayımını sınar. Ölçüm "gerçek
büyük dosyalar kayıt-şekilli değil" derse [K19-3](../../kararlar/019-buyuk-dosya-ve-kademe.md)
yeniden açılır ve kapı sırası değişir.

## Kapsam dışı

Derinlik kesimi, genel XPath'in parçaya taşınması, global sıralama, exact toplam,
tüm-belge aggregate, `sax` bağımlılığı, `XmlInputProvider` kaydı ve Excel'in
ZIP/sheet-part uygulaması. Excel bu turda yalnız ortak sözleşmeye ve bir kanıt kapısına
dahildir.
