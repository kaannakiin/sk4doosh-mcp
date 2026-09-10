# 020 — Parçalı kademenin tüketiciye görünen yüzeyi

Tarih: 2026-09-10. Durum: **kabul edildi, kodla kanıtlandı** (`packages/file-core`
0.3.0, `packages/xml-mcp` 0.4.0, `packages/excel-mcp` 0.5.0; 783 test); platform
kanıtı bekliyor. Kanıt [XML F4 kapanış kaydında](../xml/xml-f4-kapanis.md).

[Karar 019](019-buyuk-dosya-ve-kademe.md) kademeyi, parçalama yaklaşımını ve kapı
sırasını sabitledi. Uygulama sırasında o kaydın cevaplamadığı yedi nokta çıktı ve
hepsi **tüketiciye görünen** yüzeyi bağlıyor: hangi tool'un hangi kademede
çalıştığı, `mode`'un nereye yazıldığı, hangi encoding'in reddedildiği, `nodeId`'nin
tipi, damganın değeri, `ParseContext`'in şekli ve erişilebilir kayıt sayısının
sınırı. [Karar 015](015-dosya-kaynagi-cekirdegi.md)'in kuralı gereği bunlar ADR
alır; 019 kapalı ve tarihli bir kayıt olduğu için cevaplar buraya yazılıyor.

## K20-1 — Parçalı kademede üç tool çalışır, dördü açık `unsupported` döner

019 global işlemleri kapsam dışı bıraktı (K19-1) ama tool listesini vermedi;
F4-L3'ün kabul ölçütü yalnız kayıt projeksiyonunu adlandırıyordu.

Karar: parçalı kademede `list_documents`, `describe_document` ve
`project_records` çalışır. `read_node`, `find_in_document`, `select_xpath` ve
`aggregate_document` `unsupported_for_format` döner ve K18-6 tanı kalıbını
uygular: hangi yeteneğin neden yok olduğunu ve yerine ne yapılacağını söyler.

Her birinin ayrı bir teknik sebebi var, ortak bir "yapmadık" değil:

| Tool                 | Neden düşüyor                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_node`          | Assembler devam konumu için `nodeId`'yi parse ediyor ([read-node.ts](../../packages/xml-mcp/src/read-node.ts)); K20-4 `nodeId`'yi düşürüyor |
| `find_in_document`   | Arama kayıt dışını da geziyor; parçada prolog ve kök attribute'ları yok, kapsam sessizce daralırdı                                          |
| `select_xpath`       | K19-1 genel XPath'i açıkça kapsam dışı bırakıyor                                                                                            |
| `aggregate_document` | Tüm-belge aggregate; K19-1 ve K20-7 ile birlikte sayaç bile yaklaşık olurdu                                                                 |

Sıra bu yönde olmak zorunda: dar başlanıp ölçülmüş ihtiyaç çıkarsa genişletilir.
Tersi, ilan edilmiş bir yeteneği geri almak olurdu.

## K20-2 — `mode` başarı zarflarında bildirilir, hata zarflarında değil

K19-4 "her yanıt zarfında" diyor. Hata zarfları `file-core`'un `toToolError`'ında
üretiliyor ve hataların çoğu dosya açılmadan **önce** fırlıyor — o noktada kademe
diye bir şey yok.

Karar: `mode` her **başarı** zarfında ve `list_documents`'ın her girdisinde
bulunur. Hata zarfı değişmez; kademe bilgisi gerektiğinde hatanın kendi
mesajında geçer (K20-1'in dört reddi bunu yapıyor). `file-core`'un hata yüzeyi
bu kararla hiç değişmedi.

Alan `measureJson` ile ölçülen rezerve **dahil edildi**, yoksa byte kapısı
sınırda yanlış hesaplardı. Excel'de karşılığı `read_sheet`'in
`extraEnvelopeBytes` dikişidir.

Tool tablosu üzerinde exhaustive bir test var
([envelope-mode.spec.ts](../../packages/xml-mcp/test/envelope-mode.spec.ts)):
kayıtlı her handler çağrılıyor ve `mode` bekleniyor, yani yeni bir tool bunu
unutamıyor.

## K20-3 — Parçalı kademe bildirilmiş yabancı encoding'i de reddeder

K19-7 yalnız UTF-16'yı reddediyor, gerekçe `<`'in iki byte olması.

Ölçülmemiş ama aynı sınıfta ikinci bir sessiz hata var: sentetik parça **XML
bildirimini kaybediyor**. `encoding="windows-1254"` bildiren bir belge bugün
kabul ediliyor ve libxml2 doğru çözüyor; parçalı kademede o byte'lar UTF-8
sanılıp **sessizce yanlış metin** üretir.

Karar: parçalı kademe UTF-8 ve US-ASCII dışında **bildirilmiş** her encoding'i de
açık kodla reddeder. Ret sebebi `unsupported_encoding`, tanısı bildirimin
kaybolduğunu söyler.

Reddedilen alternatif — bildirimi parçaya yeniden yazmak. Ölçülmüş ihtiyaç
çıkarsa sonradan eklenebilir; ters yön mümkün değil, çünkü sessizce yanlış metin
üretmiş olurduk.

## K20-4 — `nodeId` opsiyonel bir alan olur

K19-6 parçalı kademede `nodeId`'nin üretilmeyeceğine karar verdi ama alanın
tipini söylemedi.

Karar: `Row.nodeId` opsiyonel (`nodeId?: string`). Kalıcı kademede her satırda
var, parçalı kademede hiçbir satırda yok, yokluğu
`capabilities.nodeIdentity: false` ile ilan ediliyor. Boş string veya `null`
gibi bir yer tutucu **konmadı**: ajan bir adres okuduğunu sanmamalı.

## K20-5 — `capabilities` üç yeni alan kazanır ve `(format, mode)` ile anahtarlanır

K19-4 anahtarın genişleyeceğini söyledi. Uygulamada mevcut on alan kademe farkını
ifade etmeye yetmedi.

Karar: `nodeIdentity` (K20-4), `exactTotals` ve `randomAccessRead` eklendi.
`xml-mcp` artık `capabilities[format][mode]` tablosunu
[capabilities.ts](../../packages/xml-mcp/src/capabilities.ts)'te tutuyor —
`excel-mcp`'nin modülünün deseni, anahtarı bir seviye derin.

`excel-mcp`'nin kendi tablosu **format anahtarlı kaldı**: ikinci kademesi yok ve
`modePolicy`'si her belgeyi `resident` çözüyor. Anahtarı boş bir satır için
genişletmek deseni değil gürültüyü kopyalamak olurdu.

## K20-6 — Damga dosya digest'i üzerinden hesaplanır

K19-9 native `digest` op'unun geleceğini ve fingerprint değerinin değişeceğini
söyledi. Formülün ne zaman değişeceğini söylemedi.

Karar: formül **şimdi** değişti, native op inmeden. `contentFingerprint` artık
`sha256(salt ‖ sha256(bytes))`; `fingerprintFromDigest` aynı damgayı 32 byte'lık
bir digest'ten üretiyor. Bugün digest JS'te hesaplanıyor, F4-L7B'de C++'tan
gelecek ve **değer değişmeyecek**.

Gerekçe: formülü iki kez değiştirmemek. Değişim bir kez oldu, cursor'lar bir kez
`stale_cursor` aldı.

K19-9'un pinlediği özellik korunuyor ve artık dikişte test ediliyor
([digest-identity.spec.ts](../../packages/file-core/test/digest-identity.spec.ts)):
aynı boyut ve geri konmuş mtime ile içerik değişimi yakalanıyor, ve digest
beslemeli damga byte beslemeli damgayla birebir aynı.

## K20-7 — Erişilebilir kayıt sayısı tarama bütçesiyle sınırlıdır ve bu ilan edilir

Ölçüldü (M30): 40 MiB kayıt-şekilli belgede `totalItems` 160 bin değil **50.000**
çıkıyor — span tablosu `maxItemVisits` bütçesinde kesiliyor.

Karar: bu bir hata değil, K8'in kademe karşılığıdır ve **ilan edilir**:
`totalItemsExact: false` ve `complete: false`. Sessiz bir kesme yok.

Ama bir sınır var ve yazılı durmalı: **bugün bir pencerede en fazla
`maxItemVisits` kayda erişilebiliyor.** F4-L5'in byte ipucu bu yüzden bir gecikme
optimizasyonu değil, pencereyi ilerleten **doğruluk mekanizmasıdır**; F4-L8'in
1 GB tam sayfalama yürüyüşü doğrudan buna bağlıdır.

## K20-8 — `ParseContext` kademe üzerinden ayrılan bir birleşimdir

F4-L6 "public API aralık destekli kaynağı ifade edebilmeli" diyordu; şeklini
bırakmıştı.

Karar: `ParseContext` `mode` üzerinden ayrılan bir discriminated union.
`resident` kolu `bytes: Buffer` taşır, `chunked` kolu taşımaz; ikisi de
`source: SourceReader` taşır.

Böylece parçalı bir parse `bytes`'a **tip seviyesinde** ulaşamıyor. Alternatif —
`bytes`'ı iki kolda da tutmak — derlenirdi ama yeni kodun `bytes`'a bağlanmasına
izin verir ve onu kaldırmak F4-L7'de tam olarak kaçınmaya çalıştığımız kırıcı
değişiklik olurdu.

`bytes` kalıcı kademede bir minor boyunca duruyor; F4-L6'nın kendi ölçütü budur.

## Reddedilen alternatifler

- **`mode`'u hata zarflarına da koymak.** Kademe bilinmeden fırlayan hatalarda
  alan yine olmazdı; garanti "her zaman" değil "bilindiğinde" olur, ki bu
  K19-4'ün metnini karşılamaz (K20-2).
- **`nodeId` yerine yer tutucu.** Ajan adres okuduğunu sanardı (K20-4).
- **Excel'in capability tablosunu da kademe ile anahtarlamak.** Boş bir satır
  için deseni değil gürültüyü kopyalamak (K20-5).
- **Damga formülünü native op ile birlikte değiştirmek.** Aynı kırılmayı iki kez
  yaşatırdı (K20-6).
- **Tarama bütçesini sessizce yükseltmek.** Sınırı gizler ve 1 GB'da yine
  yetmezdi; ilan + pencereleme doğru cevap (K20-7).
- **`bytes`'ı her iki kolda tutmak.** F4-L6'nın var oluş sebebini boşa çıkarırdı
  (K20-8).

## Sürümler — 019'un tablosunun yerine geçer

[Karar 019](019-buyuk-dosya-ve-kademe.md)'un sürüm tablosu hiçbir paketin
değişmediği bir anda yazıldı ve iki satırı yanlış çıktı. ADR'ler düzenlenmediği
için ([docs/README.md](../README.md) yönetim kuralı) düzeltme buraya yazılıyor;
geçerli olan aşağıdaki tablodur.

| Paket                      | 019 ne diyordu | Gerçekleşen | Gerekçe                                                                                                                      |
| -------------------------- | -------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@sk-mcp/file-core`        | 0.2.0          | **0.3.0**   | `mode` yüzeyi, `SourceReader`/`ByteRange`, `ParseContext` birleşimi, damga formülü                                           |
| `@sk-mcp/file-core-native` | 0.1.0          | 0.1.0       | Yüzey JS'te indi; C++ ve prebuild F4-L7B'de                                                                                  |
| `@sk-mcp/xml-mcp`          | 0.3.0          | **0.4.0**   | Parçalı kademe, `mode`, opsiyonel `nodeId`, üç yeni capability, 50 MiB tavan                                                 |
| `@sk-mcp/excel-mcp`        | 0.4.0          | **0.5.0**   | 019 "bu turda uygulama yok" diyordu; zorunlu `ListOptions.mode` excel'i kod değişikliğine zorladı ve zarfları `mode` kazandı |

Hiçbiri kırıcı değil: eklenen alanlar opsiyonel okunur, `nodeId`'nin yokluğu
ilan ediliyor, damga değişimi `stale_cursor` ile karşılanıyor.
