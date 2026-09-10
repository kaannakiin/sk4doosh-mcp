# Karar 014 — Spec v1.0 ve Amendment Listesi

Tarih: 2026-09-07. Durum: **kabul edildi** — [karar 010](010-versiyonlama-politikasi.md)'un
`spec-v1.0` tag'ini Faz 6 sonuna bağlayan kararı bu belgeyle karşılanır.

## Eşik karşılandı

Karar 010 v1.0 için iki koşul saymıştı:

1. `schema-conversion-rules.md`'nin "Pinlenmemiş alanlar" bölümünün üç alanı (generic wrapper soyma,
   derinlik sınırında inline'lama, `$ref` ile recursion) tanımlı hale gelmeli.
   → [Karar 012](012-tip-sekli-ve-sema-kural-katmani.md): derinlik sınırı **kaldırıldı**, döngü
   `$defs` + `$ref` ile ifade ediliyor, wrapper soyma uygulandı ve fixture'landı. Dördüncü alan
   (dizi/skaler gövde kökü) [karar 013](013-govde-koku-tel-bicimi.md) ile kapandı.
2. Spec'in taşınabilirliği **iki** bağımsız implementasyonla sınanmalı.
   → NestJS SDK'sı keşif, seçim, isimlendirme, şema, arama, görünürlük ve üç meta-tool'la
   tamamlandı; korpusun 9 türünün tamamını (140 fixture) okuyup değişiksiz geçiyor.

Sürüm `packages/spec/package.json`'da `1.0.0`; `SkMcpSpec.Version` üreticiden geliyor, elle yazılan
ikinci bir dize yok. `sdks/dotnet/turbo.json`'ın `gen` görevi artık `packages/spec/package.json`'ı
da input sayıyor — öncesinde sürüm artışı C# `gen` cache'ini geçersiz kılmıyordu ve sabit bayat
kalırdı (ölçüldü: yamadan önce cache hit, sonra cache miss).

## Damgaların akıbeti

"hipotez v0" damgası sekiz dokümandan kalktı: `isimlendirme`, `secim-hiyerarsisi`,
`arama-semantigi`, `gorunurluk`, `hata-eslemesi`, `fixture-formati`, `metadata-sozlesmesi`,
`tasima`. Her birinin yeni statü satırı hangi iki implementasyonun doğruladığını adıyla yazar.

İki dokümanda damga **kapsamlandı**, kaldırılmadı:

- `schema-conversion-rules.md` — kural katmanı normatif; ama tabloların "kaynak" sütunları yalnız C#
  tarafını listeliyor. Nest bağlaması var ve çalışıyor, karşılıkları karar 012'de yazılı, ama
  tabloya taşınmadı. Bağlama tanım gereği fixture'lanamaz.
- `caching.md` — anahtar türetimi, ad alanı, TTL/jitter, LRU, `_disabled` ve uçuş kuralı n=2; ama
  "Dağıtık kurulum" bölümünün paylaşılan depo garantileri hiçbir SDK'da uygulanmadı. O bölüm bir
  adaptör yazacak host için sözleşme taslağıdır.

## Spec amendment listesi

Faz 6'nın kuralı: Nest bir fixture'ı geçemiyorsa bu spec bug'ıdır; spec düzeltilir ve düzeltme C#'a
geriye uygulanır. Sekiz sapma işlendi. Üçü Nest'in ortaya çıkardığı **gerçek spec hatası**, ikisi
implementasyon defekti, biri iki spec dokümanı arasındaki çelişki, ikisi kapsam genişletmesi.

| #   | Sapma                                                     | Sınıf                              | Sonuç                                                                                                                                                                                                              |
| --- | --------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `PrefixMode.OnCollision` fiilen ölüydü                    | implementasyon defekti (iki dilde) | Çözülmüş ad artık **girdi**: `createToolDefinition(endpoint, name?)` / `ToolDefinitionFactory.Create(…, name)`. Katalog iddia ettiği adı geçirir. Host testi `C14`.                                                |
| 2   | İki spec dokümanı `total` hakkında çelişiyordu            | spec çelişkisi                     | `visibility.md` doğruydu (`total` deklaratiftir, probe onu değiştirmez); `search-semantics.md`'nin iki cümlesi düzeltildi. Kod değişmedi.                                                                          |
| 3   | Probe uygunluk kuralı ASP.NET aromalıydı                  | **spec hatası**                    | Çerçeve-nötr yeniden yazıldı: "kesme katmanının o endpoint için kurulu olduğu kanıtlanmış olmalı", artı platform başına tablo ve garantinin dürüst ifadesi.                                                        |
| 4   | Katalog reload'u görünürlük epoch'unu artırmıyordu        | implementasyon defekti             | `ReloadAsync` artık değişiklik token'ını **temizlemeden önce** sinyalliyor; `CallerVisibilityProvider` token'a abone olup epoch'u artırıyor. `caching.md` sırayı normatif yazdı.                                   |
| 5   | Spec var olmayan bir Nest roles decorator'ı varsayıyordu  | **spec hatası**                    | `metadata-contract.md` ve `visibility.md`'deki üç cümle düzeltildi; Nest'in auth asimetrisi normatif olarak yazıldı. Faz 6 planının "hangi kurallar farkında olmadan ASP.NET aromalı kalmış" sorusunun ilk cevabı. |
| 6   | "Kesme noktası olmayan endpoint" sınırı ASP.NET'e özgüydü | **spec hatası**                    | Cümle çerçeveye göre kapsamlandı: Nest'te keşfedilen her endpoint bir controller route'u olduğu için kesme katmanı her zaman kurulu, yedek dal hiç kullanılmaz.                                                    |
| 7   | Kart parametre sırası JS'te güvenli değildi               | kapsam genişletmesi                | Sıra kuralı normatif yazıldı (tamsayı-benzeri anahtarlar önce, sayısal artan; sonra bildirim sırası) ve 9. fixture türü `card` ile pinlendi.                                                                       |
| 8   | `validation-retry` senaryosu Nest'e karşı geçemiyordu     | kapsam genişletmesi                | `knownFields` verildiğinde mesajın baş token'ı kapalı kümeye karşı eşlenip `fields[].name` yazılıyor. C#'a geriye uygulandı. `error-mapping.md` "Faz 6'da yeniden değerlendirilir" dediği yerde kapandı.           |

Sessiz Nest istisnası yok: her sapma spec metnine ve — implementasyon defektlerinde — C# koduna
işlendi.

`metadata-extraction` korpusunun 11 fixture'ının 7'si Nest'te bir host kurulup keşiften
geçirilebiliyor ve ürettiği descriptor `createToolDefinition`'dan geçince fixture'ın beklediği
tool'a eşitleniyor ([descriptor-round-trip.spec.ts](../../sdks/nestjs/test/descriptor-round-trip.spec.ts)).
Kalan 4'ü **üretilemez** ve sebepleri ölçüldü — ikisi tek bir gerçeğe iniyor:

- `get-order-policy`, `post-order-note-with-body`, `put-replace-order`: parametre ve gövde-üyesi
  açıklamaları. Nest'te parametre açıklaması için metadata kaynağı yok; `@McpTool({description})`
  yalnız operasyon açıklamasını verir.
- `body-with-shared-type-lifts-defs`: şeması `$defs` taşıyan nesne tipli bir query parametresi.
  Nest'te adlı `@Query('x')` skaler bağlar, tam `@Query()` nesnesi ise `unbound_query_object`
  üretir — bu şekil bağlanamaz.

Skip listesi testin içinde gerekçeleriyle yazılı ve test her fixture'ın ya üretildiğini ya listede
olduğunu ayrıca doğruluyor, böylece yeni bir fixture sessizce atlanamıyor.

## Tag

v1.0'ın içeriği hazır: sürüm `1.0.0`, damgalar bu belgedeki gerekçelerle kaldırıldı ya da
kapsamlandı, amendment listesi kapandı. Kalan iş git tarafında ve depo sahibine ait — bu çalışma
commit atmadı, dolayısıyla tag'lenecek bir commit de yoktur. `spec-v1.0` tag'i, bu belgenin
"Eşik karşılandı" bölümündeki iki koşulu sağlayan içeriği taşıyan commit'e çakılır; bu belge o
tag'in gerekçesidir, işaret ettiği commit'i adlandırmaz.

## Reddedilen alternatifler

- **v1.0'ı Nest'in şema bağlaması olgunlaşana kadar beklemek.** Karar 010 eşiği açıkça iki koşulla
  tanımlamıştı ve ikisi de karşılandı. Bağlama katmanının tablo sütunlarının doldurulmamış olması
  bir kural boşluğu değil, doküman işidir; v1.0 kural setinin geri uyumluluk taahhüdüdür.
- **Damgayı tüm dokümanlardan kaldırmak.** `caching.md`'nin dağıtık bölümü ve
  `schema-conversion-rules.md`'nin kaynak sütunları gerçekten tek taraflıdır; blanket kaldırma o
  boşlukları görünmez yapardı.
- **Amendment'ları tek bir "değişiklik günlüğü"ne yazıp spec metnine dokunmamak.** Faz 6 planının
  kuralı spec'in **kendisinin** düzeltilmesiydi; ayrı bir günlük, okuyucunun iki yerden okuması
  gereken bir gerçek üretirdi.
