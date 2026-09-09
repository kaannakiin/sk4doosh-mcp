# Karar 015 — Dosya Kaynağı Çekirdeği

Tarih: 2026-09-07. Durum: **kabul edildi, kodla kanıtlandı** ([packages/file-core](../../packages/file-core), 84 test; [packages/excel-mcp](../../packages/excel-mcp), 327 test).

İkinci tüketici eşiği 2026-09-09'da `packages/xml-mcp` ile karşılandı; bu kararın parametrelediği maddelerin ölçülmüş cevapları [karar 016](016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md)'dadır.

## Ne yapıldı

`packages/excel-mcp` içindeki, Excel'e özgü olmayan makine `@sk-mcp/file-core` paketine çıkarıldı ve `excel-mcp` onun ilk tüketicisi oldu. Çıkan yüzey: sandbox yol çözümü, dizin listeleme, doküman açma/önbellekleme zarfı, hata sınıfı ve zarfı, cursor codec, format kayıt defteri, kelime tablosu, MCP tool kayıt katmanı, stdio CLI ayrıştırması, Unicode katlama.

Gerekçe: `xml-mcp` yazmak, 342 satırlık güvenlik testiyle korunan sandbox kodunu ikinci kez yazmak anlamına geliyordu. İki kopya kaçınılmaz olarak ayrışır ve ayrışan taraf güvenlik katmanı olur.

## Cetvel

Bir parça çekirdeğe girer ⟺ **format-agnostiktir** ve **her dosya okuyan sunucunun ihtiyacıdır**.

| Şekil                                            | Yer                                           |
| ------------------------------------------------ | --------------------------------------------- |
| Format-agnostik, her sunucunun ihtiyacı          | `@sk-mcp/file-core`                           |
| Tablo şekilli (dikdörtgen, A1, başlık satırı)    | `excel-mcp` içinde kalır; tetikleyici aşağıda |
| Format adaptörü (exceljs, csv-parse, magic byte) | `excel-mcp` içinde yaprak                     |

Dürüst istisna: hata kodu birleşimi. `SkMcpExcelErrorCode` tier-3 kodlarını (`encrypted_workbook`, `corrupt_workbook`, `ambiguous_delimiter`, `undecodable_text`, `unsupported_object_kind`) taşımaya devam eder. Parity testi ve `errors.spec.ts` tam kod stringlerine bağlı, ve yayınlanan bir hata-kodu tipi kapalı sayılabilir bir küme olarak `string`'ten daha değerli.

## Yayın ve sürüm

`@sk-mcp/file-core` **yayınlanır**, `private: true` değildir. Bu zorunluluktur, tercih değil: `excel-mcp` `files: ["dist"]` ile yayınlanıyor ve build düz `tsc` — repoda bundler yok. Çekirdek `private: true, version: "0.0.0"` olsaydı `pnpm publish` `workspace:^`'ı `"0.0.0"`'a yazar, **publish başarılı olur**, hata günler sonra tüketicinin `install`'unda `ETARGET` olarak çıkardı. Ne build'de, ne CI'da, ne yerelde görünürdü.

- excel-mcp'de `"@sk-mcp/file-core": "workspace:^"` → `dependencies`. `workspace:*` değil: `*` tam sürüme sabitler, çekirdek patch'i yayınlanmış tüketiciye ulaşamaz.
- `zod` ve `@modelcontextprotocol/sdk` çekirdekte `peerDependencies`. İki `zod` kopyası `z.infer` tip kimliğini bozar ve SDK'nın şema introspection'ı `instanceof` kontrolü yapan koddur. Precedent: [sdks/nestjs](../../sdks/nestjs/package.json).
- Çekirdek kendisi peer **değil** `dependencies`: `excel-mcp`'yi barındıran bir host yok, `npx` stdio CLI'ı, süreç başına bir sunucu.
- **Yayın sırası core-first, her zaman.** Çekirdek npm'de olmadan ürün yayınlanamaz.
- Çekirdek `0.x`'te kalır, `xml-mcp` onu gerçekten tüketene kadar. Bu, [karar 010](010-versiyonlama-politikasi.md)'un spec için kullandığı "iki bağımsız implementasyon" eşiğinin aynısıdır. 010 lockstep sürümlemeyi reddetmişti; burada da bağımsız sürüm kullanılıyor. **Eşik karşılandı (2026-09-09):** `xml-mcp` çekirdeği gerçekten tüketiyor ve `file-core` `0.2.0`'a çıktı. `0.x` kilidi kalktı; `1.0` otomatik değildir ve kararı [F6-08](../xml/fazlar/06-yayin-ve-kabul.md)'dedir.
- `declarationMap: false` zorunlu. Yayınlanan her `.d.ts.map` yayınlanmayan `src`'ye kırık referans olurdu — [paket-yerlesimi.md](../paket-yerlesimi.md)'nin `excel-mcp` için yazdığı gerekçe geçişli olarak buraya da uygulanır.
- CI'da `pack` job'ı iki tarball'ı paketler ve [.github/scripts/check-npm-tarballs.py](../../.github/scripts/check-npm-tarballs.py) ile doğrular: `workspace:` protokolü sağkalmamış, `@sk-mcp/*` bağımlılığı `0.0.0` değil, `dist/index.js` var, `.d.ts.map` yok. Script dört hata modunun her biri için sentetik tarball'la sınandı.
- `ci.yml`'deki test filtresi tersine çevrildi: `--filter='!@sk-mcp/sdk-dotnet'`. Eski hard-code'lu izin listesi, yeni bir paketin testlerinin sessizce hiç koşmamasının mekanizmasıydı. **Ölçülen sınır (2026-09-09):** ters filtre yalnız `node` job'ının test adımını kapsıyor. `native` ve `pack` job'larındaki dört `--filter=` satırı hâlâ açık izin listesidir ve `xml-mcp` oraya elle eklendi. Yeni bir ürün paketi bugün de o dört satırı ister; aksi halde paketlenmez, tarball denetiminden ve temiz kurulum testinden hiç geçmez.

## Yol güvenliği sırası

`resolveSourcePath`'in sıralı fail-fast zinciri **güvenlik özelliğinin kendisidir**, implementasyon detayı değil:

boş/NUL → uzantı → `isContained(joined)` → `realpath(canonicalEquivalent(...))` → `isContained(real)`

Neden bu sıra:

- Containment kontrolü `realpath`'ten **önce** de koşar. Aksi halde kök dışındaki var olan bir dosya `path_outside_root`, var olmayan bir dosya `file_not_found` alır — bu, tüm dosya sistemi için bir varlık oracle'ıdır. Aynı `outside` nesnesi iki yerden de fırlatılır.
- `realpath` sonrası **ikinci** containment kontrolü, hedefi kök dışında olan bir symlink'i yakalayan tek şeydir. "Gereksiz" diye silinemez.
- `isContained` `relative()` kullanır, `startsWith` değil: `startsWith` ile kök `/base` iken `/basel/x.xlsx` kabul edilirdi.

`listSources` aynı üç adımlı zinciri uygular. Bir dizin hatasının mesajı çağıranın kendi göreli argümanını basar, çözülmüş mutlak yolu değil.

## Güvenlik testleri hangi katmanda durur

Sandbox davranışının testleri `file-core`'a taşındı, `excel-mcp`'de yalnızca bağlantı testleri kaldı.

Kural: **generic bir özelliğin testi, o özelliği implemente eden pakette durur.** `file-core`'un suite'i her `file-core` değişikliğinde koşar ve bütün tüketicileri korur; aynı test `excel-mcp`'de dururken `xml-mcp` için hiçbir şey korumaz, çünkü `xml-mcp` `excel-mcp`'nin suite'ini çalıştırmaz.

`file-core/test/paths.spec.ts` (30 test) sentetik bir `.probe` formatı, `probe-mcp` kelime tablosu ve çıplak `FileSourceError` ile şu özellikleri sabitler: containment ve önek paylaşan kardeş, traversal, symlink kaçışı, varlık ifşa etmeme, kök dışı isim sızıntısı, symlink'li alt dizin, symlink'li kökün çalışması, düz taramanın symlink'li dizine inmemesi, `unreadable` sayacı, listelenen symlink yolunun resolver'a geri verilebilmesi, ENOENT/ENOTDIR eşlemesi. Byte yazımı fixture'lar kullanır: `globalSetup` yok, exceljs yok, suite saniyenin altında koşar.

`excel-mcp/test/paths.spec.ts` (7 test, 342 → 110 satır) yalnızca `environment` sabitinin doğru bağlandığını doğrular: kayıt defteri üç uzantıyı da çözüyor ve dördüncüyü reddediyor, mesajlar "workbook root" ve "readable spreadsheet" diyor, `recovery` `list_workbooks`'a yönlendiriyor, dizin hatası kökü sızdırmıyor, fırlatılan hata `SkMcpExcelError` — ve gerçek fixture kökü üzerinde uçtan uca listeleme çalışıyor.

`xml-mcp` de kendi eşdeğerini yazacaktır: 342 satırın kopyası değil, kendi kelime tablosu ve kayıt defteri için ~7 test. **Uygulandı:** `packages/xml-mcp/test/connection.spec.ts` bu şekli izliyor ve güvenlik suite'i kopyalanmadı.

## Bulunan hata: readable uzantı taşıyan dizin

Çıkarma sırasında kanıtlandı: kök içinde `.xlsx` uzantılı bir **dizin** `resolveSourcePath`'ten geçiyor (`realpath` dizinler için de başarılı, uzantı kapısı da geçiyor) ve `loadDocument` ajana tam mutlak yolu bildiriyordu:

```
'/private/var/folders/.../leak-RWhDyi/trap.xlsx' is not a regular file.
```

Bu bir sandbox kökü sızıntısıydı ve refactor'ün getirdiği bir şey değildi. Düzeltme: `DocumentStoreSpec.root` verildiğinde mesaj `redactRoot`'tan geçer ve `'trap.xlsx' is not a regular file.` olur — çağıranın kendi göreli argümanı, [karar 005](005-excel-okuma-semantikleri.md)'in 0.3.0 katmanının ilkesiyle tutarlı. İki seviyede regresyon testi var: store birimi ve handler uçtan uca.

## Önbellek sahipliği

Eski `document.ts` iki kusur taşıyordu.

**Modül seviyeli singleton.** Önbellek modül kapsamında bir `Map`'ti. Aynı süreçte iki format sunucusu birbirini tahliye ederdi; iki kök aynı önbelleği paylaşırdı. Yayınlanan bir pakette bu daha kötüdür: paket iki majör sürümde meşru olarak iki kez kurulabilir, o zaman iki önbellek olur; aralıklar tek kopyaya dedupe olursa çapraz tahliye olur. İki sonuç da yanlış ve hiçbiri test edilmiyordu. `createDocumentStore` her çağrıda örnek-kapsamlı bir LRU verir; `createHandlers(root)` kendi store'unu alır. `loadDocument`/`clearDocumentCache` modül seviyeli bir varsayılan store'un arkasında kalır çünkü 11 spec dosyası onu doğrudan çağırıyor — kapsam "her sunucunun paylaştığı çekirdek"ten "sadece testlerin kullandığı excel-mcp takma adı"na indi.

**CSV'ye özgü önbellek anahtarı.** `cacheKey` doğrudan `options.delimiter`/`options.encoding`'e uzanıyor ve `format !== "csv"` için sadece `path` dönüyordu: önbellek anahtarı fonksiyonu CSV'nin alan adlarını biliyordu. `xml-mcp` parse'ı etkileyen bir seçenek eklerse (`namespaceMode: "prefix" | "resolved"` gibi) ve anahtarı unutursa, store diğer moda göre parse edilmiş dokümanı **sessizce** dönerdi. `variantKey` `DocumentStoreSpec`'in **zorunlu** alanıdır: her sunucu inşa anında "seçeneklerimden hangileri parse'ı değiştirir?" sorusunu cevaplamak zorunda. `Options` type parametresi olmadan `variantKey` ve `parse` aynı tipe kaynaklanamaz ve zorlama işlevi buharlaşır. Bu, çıkarmanın en değerli tip kararıdır ve içinde hiç clever type yoktur.

Davranış değişikliği: anahtar artık her format için varyantı bir NUL ayırıcıyla ekler, sadece CSV için değil. Anahtar dahilidir.

`clearDocumentCache` barrel'dan dışa veriliyor ve hiçbir yerde kullanılmıyordu; port edilmedi, silindi. `document.ts`'in `DocumentCache` facade'ı test-yüzlü `loadDocument(path, options?)` imzasını korur.

Önbelleğin hiç testi yoktu. `documentCacheSize: 4`'te tahliye ve LRU yeniden sıralama mevcut 340 test tarafından hiç egzersiz edilmiyordu. `file-core` artık tahliyeyi, LRU yeniden sıralamayı, mtime ve boyut geçersizleştirmesini, seçenek başına girişi, iki store'un birbirini tahliye etmemesini ve `clear` izolasyonunu test eder.

## Marka tek yerde tanımlanır

`SandboxedPath` ve `Fingerprint` markaları `unique symbol` ile tanımlıdır ve nominal kimlik bildirim başınadır. **İki pakette iki bildirim aynı marka değildir**; semptomu `TS2345 ... Two different types with this name exist` olur. Bu yüzden her marka yalnızca `file-core` içinde bir kez bildirilir ve `excel-mcp` sadece `export type` ile yeniden dışa verir.

Markanın yayınlanan `.d.ts`'te sağkalması bir adım kapısıdır: `packages/file-core/dist/paths.d.ts` içinde `declare const sandboxedBrand: unique symbol` görünmelidir. Modül-özel ambient `declare const`, emit edilen bildirimde adlandırılamazsa `TS4023`/`TS9006` verir — bu `declaration: true`'nun sonucudur, `declarationMap` bunu etkilemez.

Garantinin gerçekten sınırı koruduğu ölçüldü: çıplak bir `string` `loadDocument`'a geçirilemiyor.

## Hata fabrikası property sözdizimiyle yazılır

`file-core` asla `new FileSourceError(...)` çağırmaz; her zaman verilen `fail` factory'sini çağırır. Bu, çekirdekte atılan hataların ürünün kendi sınıfı olmasını sağlar — o olmadan `paths.spec.ts`'in 30 ve `range.spec.ts`'in 14 `toThrow(SkMcpExcelError)` assertion'ı kırılırdı.

`fail` context nesnelerine **property sözdizimiyle** (`readonly fail: ErrorFactory<CoreErrorCode>`) yazılır, metot sözdizimiyle değil. `strictFunctionTypes` altında property contravariant: `ErrorFactory<SkMcpExcelErrorCode>`'un bir `ErrorFactory<CoreErrorCode>` alanına atanabilmesi için `CoreErrorCode`'un `SkMcpExcelErrorCode`'a atanabilir olması gerekir — yani **base kodlardan birini atlayan bir ürün derlenmez**. Metot sözdizimi bivariant olduğu için bu kontrolü sessizce kaybeder. Kodda görünmez bir asimetridir.

Alt sınıf `declare readonly code: SkMcpExcelErrorCode` ile kodu daraltır. `FileSourceError.code` `string`'tir; `declare` hiç kod emit etmez, sadece tipi daraltır. Onsuz `.code` üzerinde daraltma yapan her yer sessizce gevşerdi. Ölçüldü: `string` birleşime atanmıyor, `own.code` atanıyor.

## Cursor kesişimdir, iç içe yerleştirme değil

`Cursor<TPosition>` `CursorEnvelope & TPosition`'dır. Kesişim serileşen şekli aynen korur, yani 0.2.0'ın verdiği hiçbir cursor anlam değiştirmez; wire biçimi hâlâ düz `{v,f,s,r,c,e,m,g,h}`.

Engellenen hata: kendi `f`'ini bildiren bir position payload'ı kesişim altında parmak izini **gölgeler** ve `isFresh` yanlış alanı karşılaştırır — her bayat cursor sessizce geçer, ajan altından değişmiş bir dosyadan sayfa okur.

İlk deneme `TPosition extends { v?: never; f?: never }` kısıtıydı; **çalışmıyor**. Hedefin tüm alanları optional olduğunda TypeScript'in weak-type kontrolü devreye girer ve sıfır ortak alanı olan `SheetPosition` ona atanamaz. Çalışan biçim koşullu tiptir:

```
Cursor<TPosition> = [Extract<keyof TPosition, keyof CursorEnvelope>] extends [never]
  ? CursorEnvelope & TPosition
  : never
```

Tuple sarımı zorunludur: çıplak `T extends never` çıplak bir type parametresi üzerinde dağıtıcıdır ve `T = never` iken sonuç `never` olur, `A` olmaz. Reponun ilk koşullu tipidir; gölgeleyen bir position'ın `never` verdiği, çakışmayan bir position'ın zarfı koruduğu derleme-zamanı assertion'larıyla sabitlendi ve assertion'ların yük taşıdığı negatif kontrolle doğrulandı.

`invalid_cursor` ve `stale_cursor` fırlatan sarmalayıcılar `excel-mcp`'de kalır: mesajları `read_sheet` tool adını içeriyor ve bu `vocabulary.listTool` değil, yani çekirdeğe taşımak iki string için altıncı bir kelime alanı doğururdu. Çekirdek `decodeCursorPayload(raw): unknown` verir; ürünün mevcut type guard'ı aynı derleme-zamanı güvenliğini sağlar.

## Kelime tablosu

`Vocabulary<TToolName>` altı düz `readonly string` alanıdır. Çekirdekteki ~20 kullanıcı-yüzlü string 40 ayrı kelime değil, altı atom üzerinde şablonlardır.

`rootLabel` **tam isim öbeği** taşır ("workbook root"), çıplak isim değil — böylece şablonlar asla artikel birleştirmez. String kimliği regresyonlarının somut önlemi budur; taşıma sonrası yedi hata mesajının birebir aynı kaldığı çalışma zamanında ölçüldü.

`TToolName` generic'i tek bir iş yapar: `listTool`'u ürünün kendi `ToolName` birleşimine bağlar, yani bir `recovery` mesajı var olmayan bir tool'a yönlendiremez. Şu an `Vocabulary<string>` ile bağlanıyor; `ToolName`'e bağlamak tool katmanı genelleştiğinde yapılacaktır.

Tool `description` stringleri her üründe elle yazılı kalır, kelime tablosundan şablonlanmaz: bunlar kalitesi ürünün kendisi olan ajan-yüzlü prose'dur, ve şablonlamak hem prose'u bozar hem döngü yaratır (`toolDefinitions` → `vocabulary` → `ToolName` → `toolDefinitions`). Sadece çekirdek **içindeki hata** mesajları şablonlanır.

## Tier 2 neden ertelendi

Tablo katmanı (`sheet`, `range`, `columns`, `header`, `predicate`, `read-sheet`, `aggregate`, `cell-value`) çıkarılmadı. İki nedeni var.

İkinci tüketici yok. `range.ts` A1 notasyonudur; `columns.ts`/`header.ts` "hangi satır başlık" sorusunu cevaplar — XML'in soramayacağı bir soru. XML bir ağaçtır, PDF'te sayfa vardır. Katmanı şimdi taşımak, tek müşterisi yine `excel-mcp` olan bir API'yi bir hipoteze karşı şekillendirmek olurdu. [Karar 006](006-genisletme-noktalari.md)'nın "kanıtlanmış talep olmadan uzantı noktası eklenmez" hükmü burada da geçerlidir; sürüm numarası taşıyan bir paket sınırı daha pahalı bir uzantı noktasıdır.

Seam temiz değildi. Ölçüldü: `sheet.ts` doğrudan `exceljs`'i ve `workbook.js`'i, `cell-value.ts` `exceljs`'in `CellValue` birleşimini, `read-sheet.ts` ve `aggregate.ts` hem `workbook.js`'i hem `document.js`'i import ediyordu. "Grid katmanı formatı göremez" davranışsal olarak doğruydu ([format-parity.spec.ts](../../packages/excel-mcp/test/format-parity.spec.ts) bunu kanıtlıyor) ama yapısal olarak yanlıştı.

**Hazırlık yapıldı, taşıma yapılmadı.** Katman yerinde kaldı ama bağımlılık yönü temizlendi:

- Yanlış yerde duran format-agnostik semboller doğru yere taşındı: `BoundedSheet`/`requireSheetBounds` ve `DeclaredTable` artık `sheet.ts`'te, `xlsxSheetView` ise tek exceljs tüketicisi olan `workbook.ts`'te.
- `SheetSource` (`{ stamp, sheetFor(name) }`) tier-2 → tier-1 geri-kenarını kesti. `document.ts` `sheetSource(loaded)` dönüştürücüsünü verir. Saf-veri sürümü seçildi; yüklenen nesnelere `sheetFor` metodu eklemek sıfır teste dokunurdu ama LRU önbelleğin exceljs `Workbook`'u üzerinde kapanışlar saklaması demekti — `clear()` sonrası workbook sızdırmanın yolu.
- `CellSnapshot` exceljs'ten arındırıldı. Adaptör artık **olgu** (`CellFacts`: değer, `truncatedFrom`, `href`), `normalizeCell` ise **politika** üretir. Bu ayrım zorunluydu: orijinalde `includeHyperlinks` açıkken hyperlink notu `truncated` notunun yerini alıyor, kapalıyken `truncated` hayatta kalıyordu. Adaptör notu doğrudan üretirse bu öncelik kaybolurdu.
- `no-restricted-imports` kuralı grid katmanının bir format adaptörüne uzanmasını işaretler. `eslint-plugin-only-warn` her kuralı uyarıya indirdiği için kural tavsiye eder, kapı tutmaz; gerçek oracle davranışsal testlerdir. İhlal sayısı 10'dan 0'a indi ve bağımlılık kapanışı ölçüldü: grid katmanı yalnızca kendisini ve `@sk-mcp/file-core`'u import ediyor.

**Tetikleyici:** tablo katmanı ancak **ikinci bir sunucu verisinin dikdörtgen görünümünü isterse** çıkarılır — yani `pdf-mcp` tablo çıkarımı, "`xml-mcp` var olması" değil. **Doğrulandı (2026-09-09):** `xml-mcp` geldi, tetikleyici ateşlemedi, katman `excel-mcp`'de kaldı.

## Metin kodlama ertelendi

BOM tespiti, `EncodingName` birleşimi, `TextDecoder` kullanımı ve `undecodable_text` hatası `csv.ts` içinde kaldı. Gerçek gelecek talebini beklediğim tek yer burasıdır — XML hepsine artı `<?xml encoding=?>` prologuna ihtiyaç duyar. Ama bugün tam olarak bir tüketicisi var ve CSV implementasyonu aynı 64 KB baş tamponu üzerinde delimiter sniffing'e yapışık. `text-encoding` **`xml-mcp` değişikliğinde** çıkarılır: ikinci tüketici var olduğunda ve seam iki taraftan da görünür olduğunda.

**Ölçülen sonuç (2026-09-09): çıkarılmadı, ve bu bilinçlidir.** Seam iki taraftan ölçüldü ve ortak olan tek şey BOM tablosu çıktı; o çekirdeğe alındı (`packages/file-core/src/bom.ts`, saf veri, throw yok). `EncodingName` birleşimi Türkçe Excel'in kod sayfalarıdır ve XML hiçbirini adlandırmaz; `TextDecoder` kullanımının ikinci tüketicisi yok değil, ikinci tüketicinin mimarisi onu dışlıyor — XML byte'ı libxml2'ye verir ve JS'te hiç decode etmez; `undecodable_text` tier-3 Excel kodudur ve XML'in politikası ayrıdır. Cetvel'in "her dosya okuyan sunucunun ihtiyacıdır" şartı karşılanmıyor. Bu madde artık ertelenmiş değil, **kapalıdır**; yeniden açmak için `TextDecoder` tabanlı çözmeye ihtiyaç duyan üçüncü bir sunucu gerekir. Gerekçe [karar 016](016-ikinci-dosya-sunucusu-ve-yanit-butcesi.md).

## Fold ayrışması korunur

`packages/core`'un spec fold'u (`NFD → strip Mn → lowercase → NFC`, .NET'e taşınabilir) ile `file-core`'un agresif fold'u (`... → toUpperCase → toLowerCase → ...`, Türkçe `ı` ve `ß`'yi katlar) [karar 005](005-excel-okuma-semantikleri.md)'in 0.2.0 katmanında **bilinçli olarak** ayrıştırılmıştı. `file-core` agresif fold'u aldı. **İkisi asla birleştirilmez.** `İSTANBUL → istanbul` ve `straße → strasse` testleri `file-core`'da bu kararı sabitler.

Locale-bağımlı `toLowerCase`/`toUpperCase` yasağı `@sk-mcp/eslint-config/casing` olarak opt-in bir named export'a taşındı ve `file-core` ile `excel-mcp` tarafından uygulanır. `base`'e katılmadı: `packages/core` 15 yerde meşru olarak `.toLowerCase()` çağırıyor ve repo çapında uyarı gürültüsü, hiçbir şeyi kıramayacağı için okunmaz hale gelirdi.

## Zaten yapılmış olanlar

Çıkarma planı iki bug sınıfı için düzeltme öngörüyordu; kod o düzeltmeleri zaten taşıyordu ve bu belgede kayda geçirilir:

- `server.ts` `toolNames` üzerinde döngü kuruyordu; "tanımlanmış ama kaydedilmemiş tool" sınıfı çoktan ölüydü.
- `ToolHandler<K>` hayalet bir `guardedTool: K` alanı taşıyor, `guard` da `Object.assign` ile onu dolduruyordu. Yanlış `tool:` etiketiyle sarılmış bir handler'ı başka bir slota atamak derlenmiyor. Önerilen `guardAll` yeniden yazımı bu yüzden reddedildi: çözülmüş bir problemi bir cast pahasına yeniden çözüyordu.

Tool katmanı bu yüzden bug düzeltilerek değil, bir definitions map üzerinde **genelleştirilerek** taşındı: `ToolNameOf<D>`, `ToolInputOf<D, K>`, `HandlersOf<D>`, `GuardedHandler<D, K>`.

## SDK cast'i

`createFileSourceServer` içinde tek bir cast var: `handlers[name] as unknown as ToolCallback<SdkInputSchema>`. Kaçınılmazdır — SDK'nın `ToolCallback`'i koşullu bir tiptir (`Args extends ZodRawShapeCompat ? ... : Args extends AnySchema ? ... : ...`) ve `D` bir type parametresiyken TypeScript o koşullu tipi çözemez, dolayısıyla korelasyonlu hiçbir formülasyon derlenmez.

Cast bir fonksiyonun üç satırında kapalıdır ve çalışma zamanı arkalığı vardır: [packages/file-core/test/server.spec.ts](../../packages/file-core/test/server.spec.ts) iki-tool'lu bir oyuncak katalogla gerçek bir `InMemoryTransport` üzerinden `tools/list`'i, annotation'ların telden geçtiğini, argümanların handler'a doğrulanmış ulaştığını ve sınıflandırılmamış bir throw'un `internal_error` zarfına dönüştüğünü doğrular. `excel-mcp`'nin `tools.spec.ts`'i de silinmedi, amacı değişti: artık yazarın dikkatini değil, cast'i ve SDK sözleşmesini koruyor.

Aynı spec bir ayrımı da sabitler: argüman **şekli** hataları SDK/zod üzerinden protokol hata metni olarak döner, yapılandırılmış `{error, message, recovery}` zarfı değil. Karar 005 bunu söylüyordu ama testi yoktu.

## Sunucu sürümü

`createRequire(import.meta.url)("../package.json")` okuması `excel-mcp`'de **kalır**. Çekirdeğe taşınsa `file-core`'un `package.json`'ını okur ve excel sunucusunun sürümü olarak `0.1.0` bildirirdi, ya da yerleşime göre ENOENT verirdi. Sürüm `createFileSourceServer`'a bir parametredir.

Bu sessizce gidiyordu: hiçbir test sunucunun bildirdiği sürümü kontrol etmiyordu. `tools.spec.ts`'e `client.getServerVersion()` assertion'ı eklendi.

`packages/excel-mcp` sürümü `0.2.0`'dan `0.3.0`'a çıkarıldı. Karar 005 0.3.0 katmanını kabul edilmiş olarak kaydetmişti ama `package.json` geride kalmıştı; ilk publish yanlış numarayı yakacaktı.

## CLI

`cli.ts`'in hiç testi yoktu: argv şekli, usage çıkış kodu 2, başlatma hatası çıkış kodu 1, shebang ve exec biti korumasızdı. Saf `parseServerArgv(argv): ArgvOutcome` çekirdeğe çıkarıldı ve birim testi yazıldı; `process.exit`/`process.stderr` `excel-mcp`'nin shim'inde kaldı — kalmak zorunda, `bin` oraya işaret ediyor.

`runStdioServer` başarıda çıkış kodu döndürmez: `server.connect()` çözüldükten sonra süreç stdin handle'ı üzerinde canlı kalır ve `process.exit(0)` çalışan bir sunucuyu öldürürdü.

## Türetilen tipler için ileri kısıt

`export const toolDefinitions = {...}` ve `export const formats = {...}` çıkarımlanan tiplerin emit edilebilir olmasına dayanır. `isolatedDeclarations` repo çapında açılırsa ikisi de açık annotation ister. Bu kısıt bilinçli olarak kayda geçirilir.

## Reddedilen alternatifler

- **Bundle etmek.** Repoda bundler yok; `.d.ts` bundling ikinci bir araç ister; `declaration: true` bundler'la çatışır; `build` ve `check-types` aynı derlemeyi tarif etmeyi bırakır. En yüksek yeni-araç maliyeti ve bugün hiçbir şey kazandırmıyor.
- **Vendor/inline etmek.** 342 satırlık güvenlik testinin iki kopyası. Çıkarmanın amacını yok eder.
- **devDependency + sadece-tip yeniden dışa verme.** `paths.ts`, `document.ts`, `cursor.ts` runtime kodudur, tip değil. devDeps tüketici için kurulmaz.
- **İç konvansiyonu korumak** (`private: true`, `exports.types → ./src/index.ts`). Tüketicinin `tsc`'si `src`'yi tarball'da bulamaz, `TS2307` verir.
- **`publishConfig.exports` ile publish anında override.** pnpm destekler ve daha zariftir, ama repoda belgelenmiş ürün-paketi konvansiyonundan ayrışır ve repoda test edilen artefakt ile gönderilen artefakt farklı çözülür.
- **Şimdi iki paket** (generic + tabular). Seam kanıtlanmamış, ikinci tüketici yok, iki semver ve iki publish adımı.
- **Lockstep sürümleme.** [Karar 010](010-versiyonlama-politikasi.md) bunu zaten reddetti; `xml-mcp`'yi 0.3.x'ten başlatmaya zorlardı.
- **`FileSourceError<TCode extends string>` generic sınıf.** `new FileSourceError("unknwon_sheet", ...)` `TCode`'u o literal'e çıkarır ve derlenir — generic, önemli olan tek yerde (throw noktası) hiçbir şeyi kısıtlamıyor. Kod birleşimini kısıtlayan şey alt sınıfın kurucu imzasıdır.
- **`Equals<A, B>` karşılıklı-atanabilirlik kapısı** ile hata kodu sözleşmesini dondurmak. `satisfies Record<Code, 1>` kataloğu iki yönü de yakalar ve idiom repoda zaten var.
- **`UnionToIntersection` ile format seçeneklerini birleştirmek.** Bivariance hack'i gerektirir, adlandırılamaz, çakışmada okunmaz hatalar üretir. Ürünün kendi tool şemasına `...csvOptions.shape` yaymak aynı işi bedavaya yapar.
- **`const` type parametreleri.** Çağrı yerlerindeki `as const` bu kod tabanının her yerde yaptığı şeydir; `const` type param reponun ilki olurdu ve kendisi bir paragraf isterdi.
- **Template-literal tool adları / kelime tablosu.** Tool adları vocabulary'den türetilse `toolDefinitions` statik anahtarlı bir nesne literali olamazdı; bu `keyof typeof toolDefinitions` → `ToolName` → `ToolInput` → `ToolHandlers` zincirinin tamamını yok eder.
- **`capabilities.ts` ve harness'ını çıkarmak.** Dokuz anahtarın tamamı hesap tablosu ismidir; XML'in eksenleri (`namespaces`, `dtd`, `cdata`, `mixedContent`) sıfır örtüşür. Çıkarmak ya boş bir arayüz ya `Record<string, boolean>` üretir. Ayrıca harness bir spec dosyasının içinde yaşıyor; çıkarmak test-only kodu yayınlanan `dist`'e koyardı. `xml-mcp` deseni kopyalar — repoda bunun konvansiyonu var (`fixturesOf` iki yerde bilinçli kopyalı). **Uygulandı:** `xml-mcp` ortak bir yetenek arayüzü üretmedi.
- **Güvenlik testlerini `excel-mcp`'de bırakmak.** İlk denemede bırakıldı, gerekçe "aksi halde `excel-mcp`'nin `environment` sabiti test edilmeden kalır"dı. Ölçüm bu gerekçeyi çürüttü: 30 testin 25'i `file-core`'un kendi testiyle duplike, 4'ü `file-core`'da **eksik**, ve yalnızca 1 assertion gerçekten excel'e özgüydü (`recovery` içinde `list_workbooks`). Geri kalanı hata **kodlarını** assert ediyordu; `.xlsx` orada sadece "okunabilir uzantı" rolündeydi. Yani sonuç katmanlı kapsama değil, duplikasyon artı bir boşluktu. Bkz. "Güvenlik testleri hangi katmanda durur".
- **`packages/conformance`'a yeni bir fixture kind'ı.** Paketin beyan edilmiş invaryantı saf JSON'dur ve `dotnet test`'in Node'a ihtiyaç duymaması için dosya sistemi yoluyla tüketilir; dosya-kaynağı fixture'ları gerçek `.xlsx` binary'si, `crc32`'li elle kurulmuş zip ve windows-1254 byte dizileri ister. Ayrıca [fixture-formati.md](../../packages/spec/fixture-formati.md) her `kind`'ın bir spec prose dokümanıyla yönetilmesini gerektirir ve conformance diller arası taşınabilirlik içindir — ikinci dilde dosya-kaynağı implementasyonu yok.
- **`packages/spec`'e prose eklemek.** Spec, HTTP katalog sözleşmesi için normatiftir; `file-core` onun hiçbirini implemente etmez. [Karar 014](014-spec-v1-0-ve-amendment-listesi.md) spec v1.0'ı sabit sekiz maddelik amendment listesiyle kapattı, ve karar 010'un eşiği metnin iki bağımsız implementasyonla anlam kazandığını söyler.
- **Vitest `resolve.alias` ile `@sk-mcp/file-core`'u kaynağa eşlemek.** Testleri hızlı ve her zaman taze yapardı, ama test suite'i kaynağı egzersiz ederken gönderilen artefakt `dist`'i egzersiz eder; her emit seviyesi kusur onları yakalaması gereken testlere görünmez olur.

## Cetvel uygulaması

`CLAUDE.md`'nin Commands bölümündeki `pnpm --filter <paket> test` biçimi turbo'yu, dolayısıyla `dependsOn: ["^build"]`'i atlar. `excel-mcp`'nin testleri `@sk-mcp/file-core`'u `exports.default → ./dist/index.js` üzerinden çözdüğü için bu biçim bayat bir `dist`'e karşı koşabilir. Belgelenen biçim `pnpm turbo run test --filter=<paket>` olarak değiştirildi.

Kök `turbo.json`'da `check-types.dependsOn`'a `^build` eklendi. `@sk-mcp/core`'un `exports.types` `src`'ye baktığı için bugüne kadar hiçbir paket bir başkasının build'ine ihtiyaç duymamıştı; `excel-mcp → file-core` reponun ilk `dist`-tipli iç bağımlılığıdır.
