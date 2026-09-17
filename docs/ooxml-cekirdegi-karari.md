# OOXML çekirdeği — paket ayrımı ve motor seçimi

**Durum:** uygulandı (Faz A) — `packages/ooxml-core` yayınlanabilir, `@sk-mcp/excel-mcp` tüketicisi
**Tarih:** 17 Eylül 2026
**Kapsam:** `packages/ooxml-core`, `packages/excel-mcp`. `packages/xml-mcp` ve `packages/xml-lab` bu kararın dışındadır ve değişmedi.

## Sorun

`excel-mcp` OOXML paketini SheetJS'in iç zip tablosundan okuyordu: `XLSX.read(bytes, { bookFiles: true })`
sonucuna bir cast ile uzanıp `book.files`'ı kullanıyor, ardından paketi ikinci kez tutmamak için
`delete book.files` yapıyordu. İki sonucu vardı: `openPackage` parse bittikten sonra kullanılamaz
durumdaydı, ve zip okuma yeteneği tek bir formatın parse kütüphanesine asılıydı.

`.docx` ve `.pptx` aynı konteyner ailesinden — OOXML (ECMA-376): zip içinde XML — ama SheetJS onları
açmıyor, yani o kaçış kapanıyor. Ortak makine paylaşılan bir pakete çıkmadan `docx-mcp` yazılamaz.

## Karar

`packages/ooxml-core` yayınlanan bir paket olarak ayrıldı: zip part kaynağı, OPC paketi, ilişkiler,
içerik türleri ve tek geçişli XML part taraması. `excel-mcp` bu çekirdeğe geçti; `docx-mcp` ve
`pptx-mcp` aynı çekirdeğe oturacak.

### Format kelime hazinesi çekirdeğe girmez

`file-core` kuralının aynısı geçerli: `xl/`, `word/`, `ppt/` önekleri, SpreadsheetML /
WordprocessingML / PresentationML namespace'leri ve "workbook", "sheet", "document", "presentation"
adları `packages/ooxml-core/src` içinde defect'tir. Konteyner adları — package, part, relationship,
archive — ECMA-376 kelime hazinesidir ve serbesttir.

Bunun somut sonucu: `sheetParts` ve `mediaParts` çekirdeğe **girmedi**, `excel-mcp` tarafında çekirdek
`OpcPackage` üstünde türetiliyor. Karşılığında çekirdek `[Content_Types].xml` kazandı, ki `excel-mcp`
onu daha önce hiç parse etmiyordu.

### Hiçbir `@sk-mcp/*` paketi adlandırılmaz

Hata üreteci yapısal olarak enjekte edilir: `(code: OoxmlErrorCode, message: string) => Error`.
Çekirdek yalnızca kendi bildiği olguyu verir; hata sınıfını, kod kelime hazinesini ve recovery metnini
tüketici seçer — format nouns oraya aittir. `recovery` parametresi yok ve `Vocabulary` enjeksiyonu
yok, çünkü mevcut mesajlar zaten format-nötr, format kelime hazinesini yalnız recovery'ler taşıyor.

`strictFunctionTypes` bu adaptörü ayrıca **zorunlu kılıyor**: `ErrorFactory<SkMcpExcelErrorCode>`
`(code: OoxmlErrorCode, …) => Error`'a atanamaz, çünkü `corrupt_package` excel birleşiminde yok.
Adaptör kazara atlanamaz.

`asciiLower` kopyalandı (`src/primitives/text.ts`), `file-core`'dan import edilmedi. OPC part adlarını
ve `Default Extension` değerlerini ASCII-case-insensitive karşılaştırır, yani casing gerekli;
`file-core`'a bağlanmak ise MCP SDK ve zod peer'larını hiçbirine ihtiyacı olmayan bir pakete
sürükler ve katmanı ters çevirirdi. Emsal: `packages/xml-mcp/src/primitives/text.ts`.

### saxes kalır, libxml2-wasm girmez

`xml-mcp` `libxml2-wasm`'ı şeması **bilinmeyen** belge üstünde DOM ve XPath gerektiği için seçti; o
seçim worker izolasyonunu, pool'u, generation sayacını ve makine-denetimli worker modül grafiğini
getirdi. OOXML part'larında şema **bilinir** ve her okuma ileri yönlü tek geçiştir: beş SpreadsheetML
okuyucusunun hiçbiri part _içinde_ geri dönmüyor, rastgele erişim part'lar _arasında_ ve onu
`PartSource` indeksi karşılıyor. Bu yüzden `ooxml-core`'da worker yok, pool yok, WASM yok, F0-tarzı
motor kapısı yok ve `pack` guard'ında worker girişi yok.

İki XML parser sprawl değil: bilinen şema için SAX tek geçiş, bilinmeyen şema için DOM ve XPath.

### Zip fflate ile okunur

`unzipSync` + `filter` üstünde iki geçiş: sayım geçişi `filter`'dan her zaman `false` döndürerek
hiçbir şeyi inflate etmeden dizini indeksler ve red listesini uygular; okuma yalnız istenen part'ı
açar. Ölçülen davranış (`fflate@0.8.3`): `UnzipFileInfo` inflate'ten önce `name`, `size`,
`originalSize` ve `compression` veriyor, yani bomba kapısı ve red listesi bizde kalıyor.

Üç kapı birlikte çalışır, çünkü tek eşik ya gerçek dosyayı reddeder ya bombayı geçirir:

| Kapı                     | Değer   | Dayanak                                                                                                                                             |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxPartBytes`           | 384 MiB | Node `MAX_STRING_LENGTH` 512 Mi karakter; `part()` decode edilmiş string döner, tavan üstünde V8 fırlatır ve çağıran kullanılabilir bir hata alamaz |
| `maxExpansionRatio`      | 200:1   | Bu repodaki Office dosyalarında ölçülen en yüksek oran 40:1 (`ppt/slides/slide4.xml`); tek deflate akışı ~1032:1'i aşamaz                           |
| `ratioFloorBytes`        | 16 MiB  | Altında oran denetlenmez; küçük tekrarlı part normaldir                                                                                             |
| `maxDecodedPackageBytes` | 512 MiB | Çok sayıda sınır-altı part'ın toplamını bağlar                                                                                                      |

Ölçüm dayanağı: tam yükseklikte bir sheet (1.048.576 satır × 5 sütun) 214 MiB açılır ve 7.6:1
sıkışır; 50.000 satır × 10 sütun 18.4 MiB ve 6.9:1.

### Eski ikili formatlar dönüştürülmez, reddedilir

`classifyContainerMagic(magic)` çekirdeğe taşındı: saf, enjeksiyonsuz, hatasız bir 8-bayt yüklemi,
`"zip" | "cfb" | "unknown"` döner. `excel-mcp`'nin `assertReadableFormat` imzası, üç mesajı ve iki
recovery metni harfi harfine korundu; üçüncü dalın mesajı (".xlsx container") format kelime
hazinesidir ve saf-sınıflandırıcı şekli sayesinde çekirdeğe yapısal olarak giremez.

CFB sihirli baytı `.doc`, `.xls`, `.ppt` **ve şifreli OOXML** tarafından paylaşılıyor — şifreli bir
`.xlsx` de `EncryptedPackage` stream'i taşıyan bir CFB konteyneri. İkisi ayrılmıyor, çünkü bugünkü
birleşik cümle hiçbir zaman yanlış değil ve ayırmak yeni bir güvenilmeyen-bayt taraması getirir.

## Ölçümler

24 MiB'lık, 24 MiB sıkışmayan medya taşıyan bir workbook üstünde, workbook tutulurken zorlanmış
collection sonrası:

| yol                       | tutulan files tablosu | arrayBuffers | external |
| ------------------------- | --------------------- | ------------ | -------- |
| `bookFiles: true` (eski)  | 24 entry              | 48.4 MiB     | 50.1 MiB |
| `bookFiles` kapalı (yeni) | 0                     | 24.1 MiB     | 25.8 MiB |

Duvar saati her iki yolda ~215 ms, değişmedi: SheetJS `bookFiles` olsun olmasın her entry'yi inflate
ediyor, bayrak yalnızca açılmış tablonun sonradan tutulup tutulmayacağına karar veriyor. RSS düz
görünüyor çünkü sayfalar işletim sistemine iade edilmiyor. Anlamlı sayı `arrayBuffers`, çünkü belge
önbelleği aynı anda `documentCacheSize` kadar workbook tutuyor.

Göç kanıtı: `excel-mcp`'nin 29 dosyada 430 testi, A2–A5 boyunca hiç düzenlenmeden geçti. Yeni
`ooxml-source-parity.spec.ts` iki bağımsız zip implementasyonunu 12 fixture workbook üstünde
karşılaştırıyor ve part indeksi, boyutlar, baytlar, sheet part'ları, medya part'ları, part metni ve
ilişkilerin hepsinde uyuşuyor.

## Bilinen sınır

Zip entry başına şifreleme (PKWARE) tespit edilmiyor: `fflate` general purpose flag'i filtreye
göstermiyor. Office'in şifrelediği belge zaten zip değil CFB konteyneridir ve
`classifyContainerMagic` tarafından arşiv hiç açılmadan yakalanır. Şifreli bir entry bozuk part
olarak başarısız olur.

## Taşıma sırasında düzeltilen iki gizli hata

- `decode` koşulsuz UTF-8 varsayıyordu. UTF-16 bir OPC part'ında yasaldır; artık BOM sniff ediliyor,
  UTF-8 BOM'u soyuluyor ve okunamayan bir kod sayfası beyan eden part `unsupported_part_encoding`
  ile reddediliyor. Eskiden mojibake olup "well-formed değil" diye başarısız olurdu, yani yanlış
  defect'i adlandırırdı.
- `resolveTarget` içindeki `segments.pop()` fazla derin bir `..` hedefinde sessizce alttan taşıyordu.
  Artık kök üstüne çıkan hedef reddediliyor.

## Reddedilen alternatifler

- **`libxml2-wasm` / DOM.** Worker izolasyonunu, pool'u ve makine-denetimli worker grafiğini OOXML'e
  taşırdı. Kazancı yok: OOXML okumaları ileri yönlü tek geçiş, DOM'un çözdüğü problem burada yok.
- **Kendi zip okuyucumuz.** ~330 satır ve 30 vakalık bir matrisi koşul olarak getiriyordu. `fflate`
  olgun, MIT, sıfır bağımlılık, ve `filter` geri çağrısı bomba kapısını yine bize bırakıyor.
- **`asciiLower` için `file-core` bağımlılığı.** 12 satırlık bir fonksiyon için MCP SDK ve zod
  peer'larını çeker, katmanı ters çevirir ve "hiçbir `@sk-mcp/*` adlandırılmaz" kararını bozardı.
- **Süreç içi BIFF8 / Word ikili okuyucusu.** Pratikte belgelenmemiş bir ikili format için binlerce
  satır parser, güvenilmeyen girdi üstünde, tüm değeri küçük saldırı yüzeyi olan salt-okunur bir
  sunucunun içinde. Kimsenin istemediği dosyaları kabul etmek için risk eklemek olurdu.
- **`soffice --convert-to` ile dışarı çıkmak.** Salt-okunur sözleşmesini kırar (dönüştürülmüş dosyayı
  yazar), `package.json` ile ifade edilemeyen ve hiçbir CI runner'ında bulunmayan bir kuruluma
  bağlıdır, belge başına saniyeler harcar, ve güvenilmeyen girdiyi makro/URL-fetch CVE geçmişi olan
  çok büyük bir C++ yüzeyine teslim eder.
- **`PartPath` markası.** `SandboxedPath` markasını hak ediyor çünkü onu üretmek kökten dışarı bir
  path traversal — sahtelenemez bir güvenlik özelliği. Sahte bir part yolu `part()`'tan `undefined`
  döndürür: cache miss, ihlal değil; diske hiç açmıyoruz. Sürtünmesi karşılığında bir şey satın
  almıyor. Karıştırılabilirliği `Relationship` ayrık birleşimi zaten çözüyor.
- **v1'de CFB dizin okuyucusu.** Şifreli OOXML'i eski ikiliden ayırırdı ama bugünkü birleşik cümle
  hiçbir zaman yanlış değil. `ContainerKind`'a `"encrypted"` eklemek exhaustive switch'ler için
  kırıcıdır; gerekirse ayrı bir kararla gelir.
- **`sheetJsSource`'un son durak olması.** Cast'i ve `delete` hack'ini yerinde bırakır, `openPackage`'ı
  parse sonrası kullanılamaz tutar, ve zip okuyucusunu `docx-mcp`'ye sınanmamış teslim ederdi. Bunun
  yerine test-only oracle olarak `test/fixtures` altında kaldı, parity spec'i onu kalıcı olarak
  zip okuyucusuna karşı koşturuyor.
- **`mediaParts`'ı `contentTypes` üstüne taşımak.** `docx`/`pptx`'in ihtiyaç duyduğu genelleme bu, ama
  `excel` için sonuç kümesini değiştirebilir: content-type kaydı olmayan bir görsel düşer,
  `xl/media/` dışındaki bir görsel girer. Çekirdek `ContentTypes`'ı taşıyor, `excel-mcp` prefix
  filtresinde kaldı.
