# XML F4 kapanış kaydı

Durum: **kısmen tamamlandı, platform kanıtı bekliyor** (2026-09-10). F4-L1–L6 ve
L7'nin JS ayağı (L7-A) uygulandı; yerel dört-filtre koşusu yeşil: **783 test**.
Aynı gün L7'nin native ayağı da indi ve [ayrı bölümde](#f4-l7b--native-release-2026-09-10)
kaydedildi: **784 test**. [README](README.md)'nin yönetim kuralı gereği bu kayıt
`tamamlandı` değildir ve bu fazda iki ayrı sebeple değildir: platform CI koşusu
alınmadı **ve** F4-L0'ın korpus anketi ile F4-L8 hâlâ açıktır. Platform kanıtı
bölümü boş bırakıldı; L7-B'nin beş platformluk prebuild turu da o kotayı bekliyor.

Aşağıdaki ölçümler yazıldıkları anın kaydıdır ve geriye dönük düzenlenmez; L7-B
kendi bölümünde kendi sayılarını verir.

## Kabul edilen kapsam

`packages/xml-mcp` artık iki kademe sunuyor. Kalıcı kademe (≤ 8 MiB) değişmedi:
yedi tool, tam DOM, XPath 1.0, `nodeId`. Parçalı kademe (8–50 MiB) kayıt-şekilli
belgeyi kayıt sınırından keserek okuyor; `libxml2` tek semantik otorite kalıyor
ve in-house byte tarayıcısı yalnız konum üretiyor.

Kademe her başarı zarfında ve her `list_documents` girdisinde bildiriliyor.
`capabilities` artık `(format, mode)` ikilisiyle anahtarlanıyor. `maxXmlBytes`
8 MiB'den **50 MiB'ye** çıktı ve C++ hiç değişmedi.

Kapsam dışı kalanlar: derinlik kesimi, genel XPath'in parçaya taşınması, global
sıralama, exact toplam, tüm-belge aggregate, `sax`, `XmlInputProvider` ve
Excel'in ZIP/sheet-part uygulaması. Excel bu turda yalnız ortak sözleşmeye
dahildir.

## Başlangıç durumu

| Ölçüm              | Önce | Sonra   |
| ------------------ | ---- | ------- |
| Test toplamı       | 712  | **783** |
| `xml-mcp`          | 223  | **283** |
| `xml-mcp` spec     | 23   | **29**  |
| `file-core`        | 133  | **144** |
| `excel-mcp`        | 354  | 354     |
| `file-core-native` | 2    | 2       |
| `xml-mcp` tool     | 7    | 7       |

Ayrıca `SKMCP_XML_LARGE=1` arkasında 4 test daha var; varsayılan koşuda atlanıyor
çünkü 40 MiB'lık fixture üretiyorlar.

Tool sayısı değişmedi: parçalı kademe yeni tool getirmiyor, mevcutların kademe
davranışını tanımlıyor. `file-core` bu turda **değişti** (F2 ve F3'ün aksine):
`mode` yüzeyi ve kaynak sözleşmesi oraya girdi.

## Görev bazında kapanış

### F4-L1 — `mode`, tek knob, türetilmiş kapasiteler

`packages/file-core/src/mode.ts`: `SourceMode`, `ModePolicy`, `modeFor`. Fonksiyon
**toplam** (NaN ve negatif dahil hiçbir girdide throw etmiyor) ve **monoton**;
ikisi de testle sabit.

`ListOptions.mode` ve `DocumentStoreSpec.mode` **zorunlu** yapıldı. Gerekçe
[karar 016](../kararlar/016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md)'nın
cetveli: `guard`'ın `fail`'i de bilerek zorunlu kılınmıştı, çünkü opsiyonel bir
garanti "hiçbir tüketici unutamaz" argümanını çökertir. Ölçülen sonuç: derleyici
22 çağrı yerini anında işaretledi.

Tek knob `residentMaxBytes`; `maxChunkBytes`, `maxLiveChunkDoms` ve
`maxChunkParseMs` ondan türetiliyor. Dört eşitsizlik
[policy.spec.ts](../../packages/xml-mcp/test/policy.spec.ts)'te pinlendi; anlamlı
olan ikincisi: `maxLiveChunkDoms * maxChunkBytes <= residentMaxBytes`, yani
parçalı kademe hiçbir anda kalıcı kademenin bir belge için tuttuğundan fazla DOM
tutmuyor.

K19-8 gereği worker import sınırı genişledi: `neverInWorker` artık
`libxml2-wasm/lib/nodejs` varyantlarını kapsıyor ve **içerik taraması** eklendi —
worker'ın grafiğindeki hiçbir dosyanın kaynağında `xmlRegisterInputProvider`,
`xmlRegisterFsInputProviders` veya `XmlInputProvider` geçmiyor.

### F4-L2 — Sınır tarayıcısı

`boundary.ts`: byte yönlü durum makinesi (Content, Tag, AttrSingle, AttrDouble,
Comment, CData, Pi, boş element) ve `fragment.ts`: sentetik parça sarmalayıcı.
Emsal [doctype.ts](../../packages/xml-mcp/src/doctype.ts).

Tasarımda bir sadeleşme oldu: **tarayıcı şekil tahmin etmiyor.**
`project_records` zaten `itemAddress` alıyor, yani hedef qname biliniyor.
`surveyShape` ayrı ve daha ince bir fonksiyon; `describe_document`'ın örnek adres
önerisini üretiyor ve F4-L0'ın korpus anketi de onu kullanacak.

Kabul ölçütü diferansiyel oracle'dı ve öyle uygulandı
([chunked-oracle.spec.ts](../../packages/xml-mcp/test/chunked-oracle.spec.ts)):
her kayıt-şekilli fixture için tam DOM'un `scanItems` sonucu ile parça parça
parse edilmiş sonucun `(occurrence, cells)` dizileri `toStrictEqual`.

Span tablosu düz `Float64Array` (offset çiftleri, `occurrence` = index+1). 1 M
kayıtta ~16 MB; nesne dizisi ~40 MB olurdu. F4-L8 şartı.

### F4-L3 — Worker'da parça parse

`WorkerOps`'a tek satır (`projectChunks`); K17-6 gereği `WorkerRequest`/`Reply`/
`ResultOf` otomatik türedi ve worker switch'indeki `satisfies never` eksik case'i
derleme anında yakaladı.

`records.ts`'in `projectChunks`'ı bir parçayı parse edip **sonrakine geçmeden
dispose ediyor** — `maxLiveChunkDoms = 1` invaryantının uygulaması. Mevcut
`cellsOf`/`matchesWhere`/`emptyReports` değişmeden çalıştı; kayıt projeksiyonunun
zaten `XmlElement` alıyor olması bu turun en büyük reuse kazancı.

`chunked.ts` (host) span cache'i, sayfalamayı ve tanıları taşıyor. Host tarafında
kaldığı için `namespaces.ts` ve `describe.ts` import'ları **tip-only**: runtime
import olsaydı libxml2 ana sürece girerdi (K5/K6).

Parçalı kolda **worker'a hiç gidilmiyor**: `describe_document`'ın kökü,
namespace'leri, element sayısı ve derinliği byte survey'inden geliyor.

### F4-L4 — 8 MiB → 50 MiB

`maxXmlBytes = coreLimits.maxFileBytes`. C++ değişmedi, çünkü native tavan zaten
`budget > 50 * 1024 * 1024` ile yazılmış ve 50 MiB tam sınırda geçiyor.

40 MiB'lık üç fixture `SKMCP_XML_LARGE=1` arkasında
([large-file.spec.ts](../../packages/xml-mcp/test/large-file.spec.ts)); değişken
`packages/xml-mcp/turbo.json`'a eklendi, yoksa turbo geçirmez.

### F4-L5 — Byte ipuçlu cursor

`Ordinal` koluna `b?: number`. **Danışmandır, otorite değil:** ipucu ancak
ürettiği tarama gerçekten ipucunun gösterdiği kayıtta başlıyorsa kabul ediliyor,
başlamıyorsa tarama sıfırdan tekrarlanıyor. Böylece uydurulmuş bir `b` yapısal
olarak yeni bir satır üretemiyor — en fazla bir geçiş maliyeti.

Fuzz testi bunu ipuçsuz yolla karşılaştırarak doğruluyor
([chunked-cursor.spec.ts](../../packages/xml-mcp/test/chunked-cursor.spec.ts)).

### F4-L6 — `file-core` kaynak sözleşmesi

`ByteRange`, `SourceReader`, `bufferSource` ve `mode` üzerinden ayrılan
`ParseContext` birleşimi. Gerekçe ve şekil [K20-8](../kararlar/020-parcali-kademe-yuzeyi.md)'de.

**Son tarih karşılandı:** `ParseContext` artık `bytes`-only değil, yani
[F6-08](fazlar/06-yayin-ve-kabul.md) `1.0` verse bile `readRange` kırıcı
değişiklik olmaz.

Bu adım bir tuzağı da ortaya çıkardı: `xml-mcp` ve `excel-mcp` ilk `check-types`
koşusunda **geçti**, çünkü `@sk-mcp/file-core` tiplerini `dist`'ten çözüyorlar ve
`dist` bayattı. Turbo ile yeniden build edildikten sonra yedi gerçek hata çıktı.
CLAUDE.md'nin "her zaman Turbo ile build et" kuralının ölçülmüş karşılığı.

### F4-L7A — Native op yüzeyi

`readRange` ve `digest` `file-core-native`'in tiplerine ve doğrulamalarına girdi;
gövdeler bugün mevcut `read` op'u üzerinden koşuyor, yani **davranış birebir aynı,
sıfır regresyon**. F4-L7B'de değişecek tek şey o iki gövde ve `secure.cc`.

Damga formülü [K20-6](../kararlar/020-parcali-kademe-yuzeyi.md) gereği şimdi
değişti ve bir daha değişmeyecek.

## F4-L7B — native release (2026-09-10)

L7-A'nın bıraktığı iki gövde `secure.cc`'ye indi. Yüzey, tipler ve doğrulamalar
değişmedi; `index.d.ts`'e tek satır girmedi.

| Ölçüm              | L7-A  | L7-B      |
| ------------------ | ----- | --------- |
| Test toplamı       | 783   | **784**   |
| `file-core-native` | 2     | **3**     |
| `file-core`        | 144   | 144       |
| `xml-mcp`          | 283   | 283       |
| `excel-mcp`        | 354   | 354       |
| Sürüm              | 0.1.0 | **0.2.0** |

**`readRange`.** Okuma penceresi üçe ayrıldı: `openWindow` (regular mı, bütçeye
sığıyor mu), `readAt` (offset'li okuma), `closeWindow`. TOCTOU dizisi — ölçülen
boyutun bir byte ötesini yokla, yeniden `fstat`, `same()` — artık **aralık
başına** koşuyor. Aralık kendisine verilen offset'e güvenmiyor; `min(offset,
size)` ile kırpılıyor, yani uydurulmuş bir offset dosya dışına taşamıyor.

**`digest`.** SHA-256 C++'a elle yazıldı ve 64 KiB pencerelerle akıtılıyor; JS
tarafına yalnız 32 byte geçiyor. Platform kriptosuna (OpenSSL / CommonCrypto /
BCrypt) dağılmak yerine tek dosyada tutuldu: beş hedefte tek kod yolu, yeni link
bağımlılığı yok, `build.mjs` tek kaynak dosyayı derlemeye devam ediyor.

**Bütçe alanı genişliği.** Tavan artık dağınık bir `50 * 1024 * 1024` değil, tek
`maxBudgetBytes` sabiti, ve alanın genişliğine derleme zamanında bağlı:

```cpp
static_assert(maxBudgetBytes <= std::numeric_limits<decltype(Job::budget)>::max(),
              "The byte budget ceiling must fit the budget field width.");
```

`Info::size` `uint64_t`, `Job::budget` `uint32_t`. Karşılaştırma bugün yalnız
tavanın alana sığması sayesinde truncate etmiyor; tavanı büyüten bir sonraki
değişiklik artık **derlemede** durur.

**ABI.** `run(root, op, path, budget, depth, ms)` iki slot kazandı:
`run(root, op, path, budget, depth, ms, offset, length)`. `depth`/`ms` yeniden
amaçlanmadı — sonraki okuyucu için tuzak olurdu.

Windows tarafında `ReadFile` her okumada `OVERLAPPED` ile offset veriyor; dosya
imlecine güvenen sıralı okuma kalktı. Bu kod yolu yerelde derlenmedi (sınır 8).

Yerel koşu: `pnpm turbo run test` dört filtreyle, darwin-arm64, Node v24.12.0 —
784 geçti, 4 `SKMCP_XML_LARGE` arkasında atlandı. `lint` ve `format:check` temiz.
Platform matrisi **koşulmadı**.

Bu bölüm sınır 3'ü daraltıyor ve sınır 6'nın sahibini değiştiriyor; ikisi de
aşağıda güncel hâliyle duruyor.

## Paket doğrulaması

Worker modül grafiği 14 modülde kaldı: `boundary.ts`, `chunked.ts` ve
`fragment.ts` **host tarafındadır** ve worker girişinden erişilmiyor. `records.ts`
worker tarafında kalmaya devam ediyor ve yeni `projectChunks`'ı da orada.

`@sk-mcp/file-core`, `zod` veya MCP SDK'sına worker grafiğinden tek kenar yok;
ek olarak input provider içerik taraması da temiz.

Parse bayrakları değişmedi: `HARDENED` hâlâ tam olarak üç bayrak.

`pnpm pack` + `check-npm-tarballs.py` üç pakette temiz: `workspace:^` `^0.3.0`'a
çözüldü, `dist/xml-worker.js` yerinde, `libxml2-wasm` exact `0.7.2`.

## Platform kanıtı

| Alan          | Değer                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CI koşusu     | **alınmadı** — Actions kotası dolu                                                                                                     |
| XML F0 koşusu | **alınmadı**; F4-L0 kayıtları hiç üretilmedi                                                                                           |
| Commit        | **yazılmadı**                                                                                                                          |
| Native matris | **koşulmadı**                                                                                                                          |
| Yerel koşu    | `pnpm turbo run test --filter=@sk-mcp/file-core-native --filter=@sk-mcp/file-core --filter=@sk-mcp/excel-mcp --filter=@sk-mcp/xml-mcp` |
| Yerel sonuç   | 783 test: `file-core-native` 2, `file-core` 144, `excel-mcp` 354, `xml-mcp` 283 (+4 `SKMCP_XML_LARGE` arkasında)                       |
| Yerel kapılar | `check-types` ve `lint` dört pakette temiz, `format:check` temiz                                                                       |
| Yerel host    | darwin-arm64, Node v24.12.0                                                                                                            |

Bu tablo kasten eksiktir. Yerel koşu bir kapı değildir.

CI maliyeti bu fazda bir kez düşürüldü: `native` job'ının matrisi varsayılan
olarak Node 24'e indi (artifact zaten yalnız Node 24'ten yükleniyordu), Node 22
`workflow_dispatch` veya commit mesajındaki `[node22]` ile geliyor. Ağırlıklı
maliyetin kalanının ~%83'ü iki macOS bacağıdır; bu bir sonraki turun konusu.

## Ölçülen ve kararı değişen noktalar

| Bulgu                                                                                                                                                                                                        | Sonuç                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M30** — 40 MiB kayıt-şekilli belgede `totalItems` 160 bin değil **50.000**; span tablosu `maxItemVisits` bütçesinde kesiliyor                                                                              | Kesme ilan ediliyor (`complete: false`, `totalItemsExact: false`); byte ipucu bir optimizasyon değil pencereleme mekanizması oldu ([K20-7](../kararlar/020-parcali-kademe-yuzeyi.md))     |
| **M31** — Sentetik parça XML bildirimini kaybediyor; `encoding="windows-1254"` parçalı kademede sessizce yanlış metin üretirdi                                                                               | UTF-8/US-ASCII dışı bildirilmiş encoding açık kodla reddedildi ([K20-3](../kararlar/020-parcali-kademe-yuzeyi.md))                                                                        |
| **M32** — `scanItems` kayıt-dışı element kardeşleri de sayıyor; tarayıcı yalnız eşleşenleri sayarsa `scannedItems` iki kademede ayrışıyor                                                                    | Tarayıcıya kayıt derinliğindeki tüm elementleri sayan `scanned` alanı eklendi; parite tam                                                                                                 |
| **M33** — `check-types` bayat `dist` ile geçti; `file-core` Turbo ile yeniden build edilince yedi gerçek hata çıktı                                                                                          | CLAUDE.md'nin Turbo kuralı ölçüldü; kaynak sözleşmesi değişimlerinde build sırası zorunlu                                                                                                 |
| **M34** — Attribute değerinde çıplak `<` iyi-biçimli XML değil; ilk düşmanca fixture iki kademede birden parse hatası verdi                                                                                  | T24'ün attribute ayağı `>` ve `/>` ile kuruldu; `<` bu sınıfta bir tuzak değil                                                                                                            |
| **M35** — `toLowerCase()` encoding adında gerçek bir hata: Türkçe locale'de `"ASCII"` → `"ascıı"`                                                                                                            | `text.ts`'in yerel `asciiLower`'ı kullanıldı; lint kuralı yakaladı (K18-9'un ikinci kez ödeme yapması)                                                                                    |
| **M36** — Native SHA-256, 19 boyutta (padding kenarları 55/56/63/64 ve 64 KiB pencere sınırı dahil) Node'un `createHash("sha256")`'siyle birebir; `readRange` sekiz aralık şeklinde `read`+slice ile birebir | Elle yazılmış hash ve offset'li okuma kabul edildi; damga değeri L7-A'dan L7-B'ye **değişmedi**, yani cursor'lar ikinci kez bozulmadı ([K20-6](../kararlar/020-parcali-kademe-yuzeyi.md)) |
| **M37** — Ancestor yarışı altında 800 okumanın dörtte biri `digest`, yarısı `readRange`; `secretReads` 0                                                                                                     | Yeni op'lar `read`'in yarış kanıtını miras almıyor, kendileri ölçüldü; watchdog döngüsü üç op'u dönüşümlü koşuyor                                                                         |

M30–M37 numaraları bu kayda aittir. M19–M29 F3'ün, M12–M18 F2'nin, M11 F1'in.

## Kalan sınırlar

1. **Platform kanıtı yok.** CI ve XML F0 koşuları alınmadı; Actions kotası dolu.
   Sahibi **F4**.

2. **F4-L0'ın korpus anketi yapılmadı.** K19-3'ün "gerçek büyük dosyalar
   kayıt-şekillidir" varsayımı hâlâ **ölçülmemiştir** ve bu fazın en büyük açık
   riskidir. Kendi ürettiğimiz korpus bunun kanıtı olamaz: dönüştürücüyü biz
   yazarsak çıkan XML tam da tarayıcımızın çözdüğü şekle sahip olur. Ölçüm ancak
   dışarıdan gelen, dokunulmamış dosyalarla ve **gerçek agent labıyla** yapılır.
   İlk gerçek dosya (491 MiB) XML değil JSON çıktı — bu da bir veri noktasıdır.
   Sahibi **F4-L0** + **F6-05**.

3. **F4-L7B'nin kodu indi, release'i inmedi; F4-L8 açık.** `secure.cc`'de tavan,
   `readRange`, `digest` ve ABI slotları yazıldı ve yerelde yeşil, ama binary
   yalnız `darwin-arm64` için var. `linux-x64`, `linux-arm64`, `darwin-x64` ve
   `win32-x64` derlenmedi; `index.js` prebuild yoksa `unsupported_platform`
   atıyor, yani paket bugün yayınlanamaz. F4-L8'in 1 GB'ı da aynı tura bağlı,
   çünkü 50 MiB `secure.cc`'de derlenmiş bir sabittir. Sahibi **F4**.

4. **Bir pencerede en fazla `maxItemVisits` kayda erişiliyor.** İlan ediliyor ama
   sınır gerçek: 50 bininci kayıttan sonrası bugün okunamıyor. Byte ipucu
   mekanizması yerinde, pencereyi ilerleten kullanım F4-L8'de bağlanacak.
   Sahibi **F4-L8**.

5. **Parçalı kademede dört tool yok.** `read_node`, `find_in_document`,
   `select_xpath`, `aggregate_document`. Gerekçeleri
   [K20-1](../kararlar/020-parcali-kademe-yuzeyi.md)'de; hepsi açık `unsupported`
   ve düzeltme öneriyor. Ölçülmüş ihtiyaç çıkarsa genişletilebilir.

6. **Parçalı kademe hâlâ dosyanın tamamını bir kez okuyor.** Span taraması tam
   geçiş gerektiriyor ve `bufferSource` bugün tüm byte'ları tutuyor. Native
   `readRange` artık var ama `file-core` onu **çağırmıyor**: `SourceReader`'ı ona
   bağlamak ayrı bir iştir ve planlanmadı. Sahibi **F4-L8**.

7. **Windows okuma yolu derlenmedi.** L7-B `ReadFile`'ı `OVERLAPPED` offset'li
   biçime çevirdi. Senkron handle'da desteklenen biçim, ama `win32-x64` bacağı
   koşmadan bu iddia doğrulanmamıştır ve `read` de aynı yoldan geçiyor — yani
   risk yalnız yeni op'larda değil. Sahibi **F4** (sınır 1'in turu).

8. **`file-core` 1.0 kararı verilmedi.** Ama engeli kalktı: kaynak sözleşmesi
   indi. Karar **F6-08**'dedir.

## Sonraki faza devir

| Nerede                            | Ne                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [F4](fazlar/04-buyuk-dosya.md)    | Platform CI + Windows okuma yolu (sınır 1, 8), korpus anketi (2), L7-B release'i ve L8 (3), pencereleme (4), aralıklı okumanın bağlanması (6) |
| [F5](fazlar/05-genisletmeler.md)  | Parçalı kademede eksik dört tool, ölçülmüş ihtiyaç çıkarsa (sınır 5)                                                                          |
| [F6](fazlar/06-yayin-ve-kabul.md) | `file-core` 1.0 kararı (sınır 7); F6-05'in agent labı korpus anketinin de doğrulama katmanıdır (sınır 2)                                      |
