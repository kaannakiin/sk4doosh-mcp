# Karar 005 — Excel Okuma Semantikleri

Tarih: 2026-09-02, 0.2.0 ile genişletildi 2026-09-03, 0.3.0 ile genişletildi 2026-09-07. Durum: **kabul edildi, kodla kanıtlandı** ([packages/excel-mcp](../../packages/excel-mcp), 292/292 test, dosya dosya koşuldu).

## Ne yapıldı

`packages/excel-mcp` (`@sk-mcp/excel-mcp`): ajanın yerel `.xlsx`/`.xlsm` dosyalarını okuduğu bağımsız, yayınlanabilir bir MCP sunucusu. Referans [haris-musa/excel-mcp-server](https://github.com/haris-musa/excel-mcp-server) (Python + openpyxl + FastMCP).

Paket `packages/core`'a **bağımlı değil** ve olamaz: `EndpointDescriptor` zorunlu HTTP `method` + `route` istiyor, parametreler `path`/`query`/`header`, dispatch `{status, body}` dönüyor. Dosya okuyan bir sunucunun replay edeceği bir backend pipeline'ı yok. sk-mcp'nin `search_tools`/`load_tool`/`invoke_tool` kataloğuna bağlanması, spec'te HTTP olmayan bir descriptor türü gerektirir — bu karar kapsamı dışında.

CLAUDE.md yorum yasağı gereği aşağıdaki kararların tamamı yalnız bu belgede açıklanır; kodda tek satır yorum yoktur.

## Kütüphane: exceljs

|                                | exceljs 4.4.0 | npm `xlsx` | SheetJS kendi CDN'i           | `read-excel-file` |
| ------------------------------ | ------------- | ---------- | ----------------------------- | ----------------- |
| Kurulum                        | registry      | registry   | `package.json`'da tarball URL | registry          |
| Advisory                       | yok           | 2 açık     | yok                           | yok               |
| Data validation                | **var**       | yok (CE)   | yok (CE)                      | yok               |
| Formül metni + önbellek değeri | ikisi de      | ikisi de   | ikisi de                      | yok               |
| Merge aralıkları               | var           | var        | var                           | kısmi             |
| `.xls` (BIFF)                  | **yok**       | var        | var                           | kısmi             |

Belirleyici olan data validation: referans sunucunun beş okuma tool'undan biri `get_data_validation_info` ve SheetJS Community Edition `<dataValidations>` düğümünü hiç parse etmiyor — eşleştirmek `xl/worksheets/sheetN.xml`'i elle açmak demekti. npm'deki `xlsx@0.18.5` iki açık advisory taşıyor; güncel SheetJS yalnız kendi CDN'inden tarball URL'iyle geliyor, bu da committed lockfile'lı bir monorepo'da registry mirror ve offline kurulumu kırıyor.

Kabul edilen bedel: **`.xls` okunmuyor**. Uzantı allowlist'i `.xlsx` + `.xlsm`; BIFF/CFB imzalı dosya `encrypted_workbook` ile "unprotected .xlsx olarak kaydet" tavsiyesine düşüyor.

`.csv` de v1 kapsamı dışında: exceljs'in CSV okuyucusu metin hücrelerine tarih sezgisi uyguluyor, bu da "sessiz sihir yok" kuralıyla çelişir; ayrıca merge/validation/formül tool'larının dördü CSV'de anlamsız kalırdı.

Bakım riski: exceljs'in son yayını Ekim 2023, `unzipper@0.10`/`uuid@8`/`archiver@5` çekiyor. Şu an OSV advisory'si yok. Kaçış kapısı tek satır: `@zurmokeeper/exceljs` (bakımlı fork, aynı API).

## exceljs tuzakları

Hepsi bu repoda ampirik olarak doğrulandı; her biri bir tasarım kararını değiştiriyor.

- **F1 — `cell.value` falsy önbellek değerini düşürüyor.** `lib/doc/cell.js` içindeki `FormulaValue._copyModel`, `if (value) copy[name] = value` filtresi uyguluyor; önbellekteki `0`, `false`, `""` sessizce kayboluyor. Ölçüm: `{formula:"B2-100", result:0}` yazılan hücre okunduğunda `cell.value` → `{"formula":"B2-100"}`, `cell.result` → `0`. **Kural: formül hücresinde asla `cell.value` okunmaz; `cell.formula` + `cell.result` okunur.** "Önbellek yok" tespiti `cell.result === undefined` iledir — `cell.value.result` ile yapılan tespit sıfır değerli her formülü yanlışlıkla "önbelleksiz" sayar.
- **F2 — validation'lar hücre hücre açılıyor.** `data-validations-xform.js` parse anında `range.forEachAddress(address => { this.model[address] = rule })` yapıyor. `A2:A5000` + `C2:C10` iki kural, model'de **5008 girdi**. `validations.ts` bu girdileri yapısal anahtara göre gruplayıp dikdörtgene geri sıkıştırmasa tool kullanılamaz olurdu.
- **F3 — merge devam hücreleri master'ın değerini tekrar ediyor.** `MergeValue.get value()` master'a delege ediyor ve `type` `Null` değil `Merge` (=1). Beş hücrelik bir merge grid'i beş kat şişirir ve ajanı yanıltır. Varsayılan `mergedCells: "master"` devam hücrelerini `null` yapar, aralık `merges[]`'te taşınır.
- **F4 — `rowCount` ile `dimensions` farklı şeyler.** `worksheet.dimensions` yalnız `type !== Null` hücrelerden türüyor; `worksheet.rowCount` stil-only satırları da sayıyor. Fixture ölçümü: veri `A1:F10`, satır 20-5000'e yalnız `height` verilmiş → `usedRange: "A1:F10"`, `declaredRowCount: 5000`. Used range daima `dimensions`'tır; bu, referansın şişmiş `max_row` hatasının düzeltmesidir. `describe_workbook` ikisini birden yayınlar, böylece fark gizlenmek yerine görünür olur.
- **F5 — `cell.text` number format uygulamıyor.** Ham değer + kolon bazlı `numberFormat` döndürülür, `cell.text` hiç kullanılmaz.
- **F6 — tarihler UTC'ye çapalı.** `excelToDate` Date'in **UTC** anını takvim günü yapıyor. Local-time formatlama UTC-negatif her zaman diliminde günü kaydırır; serileştirme her zaman `toISOString()` iledir.
- **F7 — named import runtime'da patlar.** `index.d.ts` ESM sözdizimi kullandığı için TypeScript `import { Workbook } from "exceljs"`'i kabul eder; entry `module.exports = ExcelJS` (yerel değişken) olduğu ve enum'lar sonradan `Object.assign` ile eklendiği için `cjs-module-lexer` hiçbirini göremez. Kural: **runtime değerleri default import ile** (`new ExcelJS.Workbook()`), **tipler `import type` ile**.
- **F8 — `worksheet.dataValidations` tipsiz.** `WorksheetModel` içinde satır comment'lenmiş. Tek isimli sarmalayıcı (`validationsOf`) dışında cast yok.

Kullanılmayan API'ler: `cell.text` (F5), `worksheet.getSheetValues()` (tüm satırları materyalize eder), `worksheet.actualColumnCount` (kaynak yorumu: "performance nightmare"), `stream.xlsx.WorkbookReader` (merge ve validation vermiyor — altı tool'un üçünü sessizce sakatlar).

## Formül metni mi, önbellek değeri mi

Referans `load_workbook`'u `data_only=True` olmadan çağırıyor, dolayısıyla hesaplanmış her kolonda ajana `"=SUM(A1:A2)"` dönüyor. İstemci tarafından telafisi olmayan en büyük doğruluk hatası.

- `valueMode: "values"` (varsayılan) → grid'de `cell.result`.
- `"formulas"` → grid'de `"=" + cell.formula`. Baştaki `=` **geri eklenir**; exceljs saklamıyor. Shared formula'da `cell.formula` getter'ı `slideFormula` ile hücrenin kendi koordinatına çevirir — `value.sharedFormula` master'ın _adresini_ verir, formülü değil.
- `"both"` → önbellek değeri + her formül hücresi için `cellNotes` girdisi.

Önbellek hiç yoksa (dosya openpyxl/exceljs/pandas ile yazılmış, Excel'de hiç açılmamış): grid'de `null`, `cellNotes[addr] = {kind:"formula", formula, cached:false}`, üst seviyede `warnings`. Formül metni **asla** sessizce değer yerine konmaz. `describe_workbook` bunu veri okunmadan önce yanıtlar: `formulaCellCount` ve `cachedFormulaValueCount` ayrı ayrı raporlanır.

## Yanıt biçimi: token bütçesi

50×20 karışık içerikli sheet üzerinde ölçülen `JSON.stringify` bayt sayıları (~3,5 karakter/token):

| biçim                                             | bayt   | ~token  |
| ------------------------------------------------- | ------ | ------- |
| `{cells:[{address,value,row,column}]}` (referans) | 54.566 | ~15.590 |
| `{range, columns, values[][]}` (**seçilen**)      | 10.863 | ~3.104  |
| `{range, format:"tsv", text}`                     | 9.508  | ~2.717  |

**5,02× daha az bayt, tek okumada ~12.500 token tasarruf.** Sebep yapısal: `{"address":"A1","value":"Region","row":1,"column":1}` 52 baytının 46'sı tekrar eden anahtar adları ve `range`'den zaten türetilebilen koordinatlar.

TSV kompakt biçime göre %12,5 daha küçük ama **reddedildi**: her sayı, boolean ve `null` belirsiz string'e dönüşür, ajan zaten elinde olan tip bilgisini yeniden çıkarmak zorunda kalır. %12,5 bu kaybı karşılamıyor.

Bağlı kararlar:

- Header satırı `columns[]`'a hoist edilir, `values`'a girmez. `headerRow` yanıtta echo'lanır — **kendiliğinden** header sezgisi yok. 0.3.0 bunu korur ve iki şey ekler: `headerRowSource` satırı kimin seçtiğini söyler, `headerScan` ise ajan **açıkça isterse** satırı ispatlar. Bkz. "Başlık satırı: sezgi değil, kaynak ve ispat".
- `numberFormat` hücrede değil **kolonda** durur: 20 string, 1000 değil. `0.15`'in yüzde, `1234.5`'in para olduğunu ajana bayt başına en çok bilgiyle söyleyen alan budur.
- Nadir tipler (formül, hyperlink href, kesilmiş string) `cellNotes` sidecar'ında, adres anahtarlı.
- Aralık içi seyrek satırlar `null` dolu dizi olarak korunur; atlanırsa `columns[]` ile pozisyonel hizalama, yani kompakt biçimin tüm temeli bozulur.

## Sayfalama sözleşmesi

Referansta hiç sınır yok ve `preview_only` parametresi kabul edilip hiçbir yere geçirilmiyor — kesme hakkında yalan söyleyen ölü kod.

Limitler ([src/limits.ts](../../packages/excel-mcp/src/limits.ts), sabit; env var yok): dosya 50 MB · yanıt hard cap 10.000 hücre · varsayılan 2.000 · serialize 512 KB · hücre başına 512 karakter. Byte cap gereksiz değil: bir Excel hücresi 32.767 karakter tutabilir, 2.000 hücre 64 MB'a serialize olabilir. Hangisi önce bağlarsa `truncationReason` onu söyler. İlerleme garantisi için her zaman en az bir satır döner.

`nextCursor` = base64url(`{v,f,s,r,c,e,m,g,h}`); `f` = `sha256(realPath:mtimeMs:size)` ilk 16 karakteri. Her cursor okumasında fingerprint diskten yeniden hesaplanır; uyuşmazlık `stale_cursor`. Referansta karşılığı yok — orada sayfalama ortasında dosya değişirse iki farklı dosyanın satırları sessizce birleşir. Aynı fingerprint'le anahtarlanan 4 girdilik LRU workbook cache: staleness tespiti ve cache invalidation aynı mekanizmadır.

`cursor`, `sheetName` veya `range` ile birlikte gelirse `invalid_argument` — sessiz çözüm yok.

500k satırlık bir sheet'i sayfalamak doğru plan **değil** (~29M token) ve tool'lar bundan aktif olarak uzaklaştırır: `describe_workbook` 5.000 satır üstünde `guidance`, `read_sheet` kesmede `hint`, `find_in_sheet` içeriğe göre rastgele erişim. Sunucu tarafı filtreleme/agregasyon v2.

## Tip eşlemesi

| Excel                           | JSON                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------- |
| boş hücre / boş string          | `null` / `""` — **ayrı**; referans ikisini birleştiriyor                        |
| sayı, yüzde `0%`                | `0.15` + kolonda `numberFormat: "0%"`                                           |
| tarih (tarih numFmt)            | `"2026-01-15"`; UTC saati tam `00:00:00.000` ve numFmt'te saat token'ı yoksa    |
| tarih-saat                      | tam ISO + `Z`, her zaman `toISOString()`                                        |
| `General` formatlı tarih serisi | sayı (exceljs dönüştürmüyor); `numberFormat` nedeni söyler                      |
| 1904 workbook                   | 1900 ikiziyle aynı takvim; `dateSystem: "1904"` echo                            |
| hata                            | `{"error":"#DIV/0!"}` — içeriği `#REF!` olan metin hücresinden ayırt edilebilir |
| rich text                       | run'lar birleştirilmiş düz metin (biçim run'ları düşer)                         |
| hyperlink                       | görünen metin; href yalnız `includeHyperlinks` ile `cellNotes`'ta               |
| merge devam hücresi             | `null` (`mergedCells: "master"`), aralık `merges[]`'te                          |
| 512 karakterden uzun string     | kesilir + `{kind:"truncated", length}` notu                                     |

Boş sheet: `usedRange: null`, okuma `empty_sheet` hatası.

## Yol güvenliği

Sandbox kökü **zorunlu pozisyonel CLI argümanı**: `npx -y @sk-mcp/excel-mcp /data/sheets`. Env var yok — bu aynı zamanda turbo tarafında hiçbir `env`/`passThroughEnv` beyanı gerektirmemesi demek. Kök başlangıçta doğrulanır (var mı, dizin mi, `realpath` alınabiliyor mu); değilse stderr + non-zero exit, ilk tool çağrısında geç patlamaz.

Mutlak yollar kabul edilir **ama** aynı containment kontrolünden geçer. Referansın transport'a bağlı davranışı (stdio = sınırsız mutlak yol, HTTP = jail) footgun: stdio sunucusunu ajan runtime'ı başlatır ve ajana `../../../.ssh/id_rsa` pekâlâ söyletilebilir.

```ts
function isContained(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rest = relative(root, candidate);
  return (
    rest !== "" &&
    rest !== ".." &&
    !rest.startsWith(`..${sep}`) &&
    !isAbsolute(rest)
  );
}
```

`candidate.startsWith(root)` yanlış: `"/base-evil/x.xlsx".startsWith("/base")` → `true`. `rest.startsWith("..")` ters yönde yanlış: kök içindeki meşru `..archive.xlsx` dosyasını reddeder. `path.relative` + tam `".."` / `".." + sep` kontrolü ikisini de doğru çözer; fonksiyon saf olduğu için dosya sistemi olmadan test edilir.

Sıralı fail-fast ve her aşamanın tek hata kodu: NUL/boş → uzantı allowlist → **sözlüksel containment** → `realpath` → symlink sonrası containment → `open` + `fstat` → magic byte → boyut.

Containment'in `realpath`'ten **önce** de yapılması bilinçli: aksi halde kök dışındaki var olan dosya `path_outside_root`, olmayan dosya `file_not_found` dönerdi — sandbox dışı için bir varlık oracle'ı. İki kontrol de aynı hatayı verir.

Kontrolden sonra okuma **handle üzerinden** yapılır (`handle.createReadStream`), yol üzerinden değil: kontrol ile açma arasında yol takas edilemez.

Magic byte tablosu — bu kontrol olmadan şifreli bir `.xlsx`, zip katmanının `invalid signature: 0xe011cfd0` mesajıyla patlar; teknik olarak doğru, ajan için tamamen kullanılamaz:

(0.3.0 düzeltmesi: bu mesaj `stream.xlsx.WorkbookReader`'ın kullandığı unzipper'a aitti, oysa yukarıda :45'te o okuyucunun bilinçli olarak hiç çalıştırılmadığı yazıyor. Fiilen çalışan yol `workbook.xlsx.read` → **JSZip**'tir; ölçülen mesajları aşağıdaki 0.3.0 bölümünde.)

| ilk baytlar               | anlam                                 | kod                  |
| ------------------------- | ------------------------------------- | -------------------- |
| `50 4B 03 04`             | OOXML zip                             | devam                |
| `D0 CF 11 E0 A1 B1 1A E1` | CFB: şifreli OOXML veya legacy `.xls` | `encrypted_workbook` |
| diğer                     | spreadsheet değil                     | `corrupt_workbook`   |

**Bilinen ve kabul edilen açık:** zip bomb (küçük `.xlsx`, gigabaytlık açılım) boyut cap'ini deler; cap sıkıştırılmış dosyayı ölçüyor. Tehdit modeli kullanıcının kendi seçtiği yerel klasör olduğu için v1'de savunulmuyor. Savunma, ZIP merkezi dizinindeki sıkıştırılmamış boyutları exceljs'e vermeden önce okumak olurdu.

## Hata modeli

[packages/core/src/errors.ts](../../packages/core/src/errors.ts) ev stili (`readonly code` ilk parametre, string-literal union, `this.name`), üstüne bir alan: `recovery`.

24 kod, her biri tam olarak bir doğrulama aşamasına karşılık gelir: `invalid_argument`, `path_outside_root`, `unsupported_extension`, `file_not_found`, `not_a_file`, `file_too_large`, `encrypted_workbook`, `corrupt_workbook`, `undecodable_text`, `ambiguous_delimiter`, `unsupported_for_format`, `unknown_column`, `ambiguous_column`, `unknown_sheet`, `ambiguous_sheet`, `empty_sheet`, `unknown_header_row`, `ambiguous_header_row`, `invalid_range`, `invalid_pattern`, `range_outside_used_range`, `invalid_cursor`, `stale_cursor`, `internal_error`.

(Bu satır 0.2.0'da bayatlamıştı: "15 kod" yazarken union'da 22 vardı. 0.3.0'da `legacy_xls_format` **çıktı** — `.xls` uzantı allowlist'ini hiç geçemediği için CFB imzası her zaman `encrypted_workbook`'a düşüyordu, yani kod üretilemezdi; `internal_error`, `unknown_header_row` ve `ambiguous_header_row` girdi.)

`recovery` bu tasarımın ajan ergonomisi açısından en yüksek kaldıraçlı parçası — başarısız bir çağrıyı yeniden deneme döngüsü yerine başarılı bir sonraki çağrıya çevirir: `unknown_sheet` mevcut sheet'leri **gizli olanlar dahil** listeler (göremediğini isteyemez), `invalid_range` sheet'in gerçek used range'ini söyler, `file_not_found` `list_workbooks`'a yönlendirir.

Yüzeyleme: **`isError: true` + yapılandırılmış JSON gövde**, throw ederek değil.

- `isError: true`, çıplak sonuç değil: `SkMcpMetaTools`'un `isError`'sız `{error,message}` deseni orada doğru — 403 `invoke_tool`'un meşru sonucudur. Burada `unknown_sheet` "hiçbir şey okunmadı" demek. İstemciler `isError: true`'yu başarısız çağrı olarak gösterir ve model bunu "farklı dene" diye işler; referansın düz `"Error: <msg>"` metni ise içeriği "Error" olan bir hücreden ayırt edilemez.
- Throw edilmiyor, çünkü MCP SDK yakalayıp `createToolError(error.message)` üretiyor — **`code` alanı siliniyor**. Makine-okunur sözleşme handler sınırında catch gerektirir. `asExcelError` sınıflandıramadığı throw'ları **`internal_error`**'a eşler ve `recovery` **vermez**; ayrıntı için aşağıdaki 0.3.0 bölümü. (0.2.0'da bu eşleme `corrupt_workbook`'tu ve yanlıştı.)
- JSON-RPC protokol hatası kullanılmıyor: argüman **şekli** hataları zaten zod ile SDK katmanında protokol hatası oluyor; argüman **semantiği** hataları (olmayan sheet, veri dışı aralık) tool hatası kalıyor.

## Tipler: zod 4

`McpServer.registerTool`'un JSON Schema girişi yok — imza `InputArgs extends undefined | ZodRawShapeCompat | AnySchema`. Elle yazılmış bir `Infer<>` type utility'sine geçmek `McpServer`'ı bırakıp düşük seviye `Server` + elle `setRequestHandler` + elle runtime validator yazmayı gerektirirdi; `params.arguments` tel üzerinden `unknown` geldiği için derleme zamanı inference orada sıfır güvenlik verir.

zod 3 değil **zod 4**: kurulu `@modelcontextprotocol/sdk@1.30.0` zaten `zod@4.5.4` ile çözülmüş durumda (peer `^3.25 || ^4.0`, `optional: false`). zod 3 seçmek dedupe etmez, ikinci bir kopya ekler.

Advanced-types'ın gerçekten kazandığı üç yer:

1. **`SandboxedPath` nominal brand'i** — `SandboxedPath` üretmenin tek yolu `resolveWorkbookPath()`, dolayısıyla `loadWorkbook(path: SandboxedPath)` ajandan gelen ham string'le derleme zamanında çağrılamaz. Güvenlik sınırı disiplinle değil tip sistemiyle zorlanır.
2. **`ToolHandlers` mapped type'ı** — `{ [K in ToolName]: (args: z.infer<(typeof toolDefinitions)[K]["inputSchema"]>) => Promise<CallToolResult> }`. Tool tanımına yeni bir giriş eklenip handler yazılmazsa derleme kırılır; `ToolName` union'ı `keyof typeof toolDefinitions`'tan türer. Kaydın da eksiksiz olduğunu `test/tools.spec.ts` gerçek bir `InMemoryTransport` üzerinden `tools/list` ile doğrular.
3. **`cell-value.ts`'te `assertNever`** — exceljs `CellValue` union'ında tüketilmemiş varyant kalırsa derleme kırılır.

## v1 kapsam sınırları

Ertelenenler: tüm yazma işlemleri, tüm biçimlendirme, `merge_cells`/`unmerge_cells`, chart, pivot, table oluşturma, formül **değerlendirme** (referansta da yok; yanlış bir evaluator hiç evaluator olmamasından kötüdür), `numberFormat` ötesi stil okuma, `.xls`/`.xlsb`/`.ods`/`.csv`, streaming reader, çok köklü sandbox, `outputSchema`/`structuredContent` (ikisini birden vermek grid'i telde iki kez taşır).

Referansın `validate_excel_range`'i bilinçli olarak atıldı: adı data validation'ı çağrıştırıyor ama A1 string'i ayrıştırıyor, ve ajana bir round-trip'e mal oluyor. İşlevi `read_sheet`'in `invalid_range` hatasına katlandı — `recovery` alanı sheet'in gerçek used range'ini söylediği için o hata ayrı çağrının döndürdüğünden fazla bilgi taşıyor. `preview_only` referansta zaten ölü parametre, taşınmadı.

Eklenen iki tool: `list_workbooks` (sandbox'lı sunucuda dosya keşfinin tek yolu — referansın stdio modunda sınırsız mutlak yol olduğu için keşif istemcinin problemiydi) ve `find_in_sheet` (büyük sheet'i sayfalamadan tarif edilebilir kılan tek şey).

---

# 0.2.0 eklemeleri

## Unicode katlama ve `packages/core` ile sapma

0.1.0'da `find_in_sheet` Türkçe'de bozuktu: `toLowerCase()` `İ`'yi `i` + U+0307'ye açtığı için `"İSTANBUL"` içinde `"istanbul"` bulunamıyordu. Ayrıca `cell-value.ts` truncation'ı 512. karakterde surrogate çiftini ortadan kesip bozuk string üretiyordu (`"x".repeat(511)+"😀"`, ölçüldü).

[src/unicode.ts](../../packages/excel-mcp/src/unicode.ts)'teki `fold` dil-bağımsızdır ve `toUpperCase().toLowerCase()` turu içerir:

```ts
text
  .normalize("NFD")
  .replace(/\p{Mn}/gu, "")
  .toUpperCase()
  .toLowerCase()
  .normalize("NFC");
```

Bu tur noktasız `ı`'yı (`ı`→`I`→`i`) ve `ß`'yi (`SS`) de kapsar. `Intl.Collator("tr", {sensitivity:"base"})` reddedildi: ölçümde `ISTANBUL ~ istanbul` için **false** dönüyor — locale-aware yaklaşım tuzak.

Sonuç ve bilinçli tercih: `caseSensitive: false` artık **aksan-duyarsız da**; `sık` ile `sik` eşleşir. Üçüncü mod yoktur. `regex` modu **katlanmaz** — pattern bir programdır, sunucu kullanıcının programını yeniden yazmaz; `\p{`/`\P{` içeren pattern `invalid_pattern` ile reddedilir (`u` flag'i eklemek ajanların alışkanlıkla yazdığı `\-`'yi kırardı, eklememek `\p{L}`'yi sessizce literal yapardı — ikisi de ölçüldü). `find_in_sheet` hangi eşleştirmenin uygulandığını `matching` alanıyla echo'lar.

**`packages/core` aynı bug'ı taşıyordu ve C# ikiziyle sessizce ayrışıyordu.** Ölçüm: `tokenize("İSTANBUL")` TS'te `["i̇stanbul"]`, C#'ta `["istanbul"]`. `arama-semantigi.md:44` hangi küçültmenin kullanılacağını söylemediği için **ikisi de spec'e uygundu** — bu bir spec boşluğuydu. Kapatıldı: kural 3 normatif fold tanımıyla değiştirildi, üç conformance fixture eklendi (50 → 53) ve iki SDK aynı commit'te düzeltildi.

Ama oradaki fold **excel-mcp'ninkinden farklıdır** ve olmak zorundadır: .NET `ToUpperInvariant('ı')` → `'ı'`, `"ß".ToUpperInvariant()` → `"ß"` (ölçüldü, ICU modunda). Yani `toUpperCase()` turu portable değil. Spec'teki fold turu içermez:

```
NFD → \p{Mn} at → küçük harf → NFC
```

19 test dizesinde JS ve .NET **birebir aynı** sonucu veriyor. Bedeli: `ı` ile `i` ayrı kalır, `ß` açılmaz — ve `dotless-i-stays-distinct.json` fixture'ı bu sınırı iki SDK'da da sabitler. Fixture'lara `ß` **konmadı**.

excel-mcp agresif fold'unu korur çünkü C# ikizi yoktur ve `@sk-mcp/core`'a bağımlı değildir (paket yayınlanabilir, `files:["dist"]`; beş satır kopyalamak doğru maliyet).

ESLint kuralı `packages/excel-mcp` içinde çıplak `toLowerCase()`/`toUpperCase()` kullanımını yasaklar; `unicode.ts` muaftır. Kural yazarken kendi kodumu yakaladı.

## CSV

Kütüphane **`csv-parse@^7`** (sıfır bağımlılık, MIT, native ESM). exceljs'in CSV okuyucusu 0.1.0'da CSV'yi kapsam dışı bırakan sebepti: `"01234"` → `1234`, `"03-04-2024"` → `Date`, `"true"` → `boolean`, `"#N/A"` → `{error}`. csv-parse varsayılanı **hiç tahmin etmez**; `cast` parametresi sunulmaz, çünkü `cast: true` `"01234"`'ü `1234` yapar — değiştirdiğimiz davranışın aynı sınıfı. `capabilities.csv.typedValues: false` bunu beyan eder.

**Mimari.** `loadWorkbook` iki iş yapıyordu: güvenlik/cache zarfı ve exceljs parse. Zarf [src/document.ts](../../packages/excel-mcp/src/document.ts)'e çıkarıldı; `workbook.ts` `parseXlsx`, `csv.ts` `parseCsv` export eder. Böylece **`workbook.ts` tek exceljs tüketicisi** özelliği korunur ve ikizi kurulur: `csv.ts` tek `csv-parse` tüketicisi.

[src/sheet.ts](../../packages/excel-mcp/src/sheet.ts)'teki `SheetView` iki formatın da uyduğu arayüzdür. Soyutlama zaten vardı: `read-sheet.ts` her hücrede bir `CellSnapshot` kurup `normalizeCell`'e veriyordu ve `CellValue` union'ı zaten `string` içeriyor. Refactor sonrası `readSheet` ve `findInSheet` **formatı hiç göremez** — sayfalama, `maxCells`, `maxPayloadBytes`, `truncationReason`, `nextCursor`, `cellNotes` tek kod yolundan geçer. "Aynı davranış" bir söz değil yapısal bir gerçektir ve `test/format-parity.spec.ts` bunu doğrular. Refactor CSV kodu yazılmadan önce yapıldı, böylece mevcut 130 test gerçek bir oracle oldu.

exceljs `Worksheet` sentezlemek reddedildi: ikinci exceljs tüketicisi olurdu, hücre başına ~200-400 bayt harcardı ve `model.merges` `[]` dönerek "ölçüldü, merge yok" **yalanını sentezlerdi**.

**Ayraç.** Parametre isimli enum (`comma`/`semicolon`/`tab`/`pipe`) — tek karakter parametresi ajanı literal tab göndermeye zorlar, ajanlar `"\\t"` yollar, sessizce eşlemek yasak sihirdir. Sniff çözülmüş metin üzerinde, ilk 20 satır / 64 KB, tırnak dışı sayımla, başlık satırında görünmeyen aday elenir, kazanan **tek başına kesin maksimum** olmalıdır. Beraberlik `ambiguous_delimiter` — çakışma hatadır. Hiçbiri başlık satırında yoksa dosya tek kolonludur, ayraç **gözlemlenemez** ve her seçim aynı tabloyu üretir: `,` seçilir, `delimiterSource: "default"` echo'lanır. Tahmin değil, ispat.

**Encoding.** Sıra: açık parametre → BOM → utf-8. Açık parametre BOM'la çelişirse `invalid_argument` — bu tek kural windows-1254 + UTF-8 BOM mojibake'sini (`ï»¿kod`) üretmeden öldürür. Doğrulama `TextDecoder(..., {fatal})` ile, ve `fatal` yalnız encoding **verilmediğinde** açıktır: tek baytlık encoding'lerde her bayt eşlendiği için `fatal` hiç atmaz, onu sunmak tiyatro olurdu. Ölçüm: `iso-8859-9`, `latin5`, `cp1254` hepsi `windows-1254` alias'ı, dolayısıyla yanıtta **`decoder.encoding`** echo'lanır, istenen etiket değil.

BOM'suz UTF-16 fatal utf-8 decode'unda **atmaz** (NUL'lar geçerli UTF-8), bu yüzden ayrı bir NUL taraması vardır — ama yalnız çözülen encoding utf-16 **değilken**; aksi halde açıkça istenen UTF-16'yı reddederdi (ilk implementasyonda öyleydi, test yakaladı).

**Tool davranışı.** Yöneten kural: _no-op olan varsayılan no-op kalır; formatın taşıyamadığı açık istek hatadır._ `get_merged_ranges` ve `get_data_validations` CSV'de `unsupported_for_format` döner, boş sonuç değil — `{merges: [], count: 0}` **ölçüm yapıldı ve bulunamadı** iddiasıdır, oysa olgu "bu formatta merge ifade edilemez". Format kontrolü **parse'tan önce**, uzantıdan yapılır; aksi halde encoding'i verilmemiş bir CSV'de `undecodable_text` dönerdi (ilk implementasyonda öyleydi, uçtan uca smoke yakaladı).

`describe_workbook` uygulanamaz metrikleri `null` yapar, `0` değil: `0` ölçüm iddia eder, `null` sorunun uygulanmadığını. `capabilities` statik tablosunu `test/capabilities.spec.ts` her format × her bayrak için doğrular; o test olmadan blok JSON kostümü giymiş dokümantasyon olurdu.

CSV'nin sheet adı literal `"csv"`: `null` üç tipli sözleşmeyi kırar, dosya adı `filePath`'in ikinci kopyası olur ve yeniden adlandırmada değişir, `"Sheet1"` kullanıcının seçtiği izlenimi verir.

**Köşe noktaları.** Düzensiz satır tolere edilir ve `raggedRecordCount` ile bildirilir — okuma sunucusunun işi dosyada ne varsa raporlamaktır, ve eksik alan belirsiz değildir. Tırnak içi satır sonu sayfalamayı bozmaz çünkü önce `rows[][]`'e parse edilir ve API'deki "satır" fiziksel satır değil **kayıttır**; stream-and-skip tasarımı tam burada kırılırdı. Yinelenen başlık hata değildir — pozisyonel parse edilir, anahtar uzayı yoktur, hiçbir şey çözülmez; repo kuralı sessiz **çözümü** yasaklar. Boş satır atlanmaz (atlamak satır numaralarını sessizce kaydırırdı). CSV injection: değer değiştirilmez, hata verilmez, yalnız `=` ile başlayanlar sayılır — `+`/`-`/`@`'ı da işaretlemek her negatif sayıyı ve her e-postayı yakalar, uyarıyı gürültüye çevirirdi.

**Bellek.** Streaming yok: sayfalama kayda göre rastgele erişim ister ve stream-and-skip her sayfa için baştan parse edip dosyanın sayfalama ortasında değişmesi sorununu geri getirirdi — `fingerprint` + `assertFresh` sözleşmesi tam da bunu kapatıyordu. 50 MB dosya cap'i parse edilmiş boyutu sınırlamadığı için iki yeni limit var: `maxCsvBytes: 16 MB` (fstat'tan pre-flight) ve `maxCsvCells: 2M` (`on_record`'da biriken asıl bağlayıcı). Cache anahtarı parse opsiyonlarını içerir — sniff edilen ayraç parse'ın özelliğidir ve cache'lenen şey parse'tır.

CSV'de **zip bomb açığı yoktur**: cap içeriği birebir ölçer. Yukarıdaki xlsx açığının CSV'de karşılığı yok.

## `aggregate_sheet`

20k satırlık bir sayfada "hangi bölge en yüksek toplama sahip?" sorusu 0.1.0'da ~10 `read_sheet` çağrısı ve ajanın kendi aritmetiği demekti. Ölçüm: tek çağrı **306 bayt ≈ 87 token**; tarama 20k satırda **3 ms**, parse **131 ms** — tarama parse'ın 1/40'ı. Bedeli `tools/list`'te ölçüldü: 4.213 → **8.114 bayt ≈ 2.318 token**.

Birleşik `query_sheet` (metrics yoksa satır, varsa agregat) ölçüldü — 872 vs 1.659 token, %47 tasarruf — ve **reddedildi**: mod anahtarı dönüş şeklini sessizce değiştirir, `outputSchema` yok, ajan tek ad altında iki şekil taşımak zorunda kalırdı. `headerRow`'u **kendiliğinden** sezmeyi reddeden paket bunu da reddeder. (0.3.0'ın `headerScan`'i bu cümleyi çürütmez: orada dönüş şekli sabit kalır ve hesaplama ajanın açık talebiyle yapılır.) `sort_sheet` kalıcı olarak düştü (limitsiz sıralama sayfalamanın süslüsü). `profile_columns` düştü: kolon sansürü **etkilediği agregatın yanına** iliştirilir, ayrı çağrıya değil, ve ön-keşif `unknown_column`'ın recovery'sinden bedavaya gelir.

**Kolon adresleme.** Tek string: başlık metni veya A1 harfi, `columnMode` ile zorlanabilir. Başlık eşleşmesi `fold` ile. Yinelenen başlık `ambiguous_column` — asla "ilki kazanır". Başlık/harf çakışması da öyle; `columnMode` tam bunun içindir. Sayısal başlık (`2026`) **başlık değildir**: `readHeader` zaten string olmayanı `null` yapıyordu ve `read_sheet` bu sözleşmeyle shipped — böylece "2026 başlık mı veri mi" sorusu hiç sorulmaz, dürüst yanıt paketin bilemeyeceğidir.

**Tip semantiği.** `date` kind'ı tam olarak `formatDate()`'in ürettiği yüzeydir, dolayısıyla sınıflandırıcı serileştiriciyle asla çelişemez. **Karşılaştırma türünü ajanın sağ operandı belirler, hücre değil**; farklı türden hücre eşleşmez ve **sayılır**. Sezgiye aykırı ama kasıtlı sonuç: `not(x > 5)` ≠ `x <= 5` — metin hücresi ikisini de sağlamaz. Tarihler ISO'da sözlüksel karşılaştırılır (bayt sırası = kronoloji), tek normalizasyon `YYYY-MM-DD` → `+T00:00:00.000Z`.

Aritmetik yalnız sayıda; `min`/`max` kolonun **çoğunluk türünde** çalışır ve `kindUsed` echo'lanır — "en erken sipariş tarihi" bir sayfanın en sık ikinci sorusudur ve tarihler string'dir. Muhasebe değişmezi her metrik kolonu için `counted + skipped === matchedRows`; hiçbir şey `skipped`'da görünmeden düşemez, `columnStats` nedenini söyler.

`sum` boş/tümü-null grupta **`null`, `0` değil** — `0` gerçek sıfır toplamdan ayırt edilemez. `groupBy` yokken hiçbir şey eşleşmezse **tek satır** döner (`count: 0`), sıfır satır değil.

**Neumaier toplama.** Ölçüm: 500 tane `0.1` naive'de `49.99999999999996`, Neumaier'de tam `50`; 500k karışık büyüklükte naive **3,87 mutlak** sapıyor; maliyet 5M toplamada 48 ms vs 80 ms. Yayınlanan değer **yuvarlanmaz** — `0.30000000000000004` doğru yuvarlanmış double'dır. `stddev` **örneklem (n−1)**, Excel `STDEV` ile aynı, Welford ile.

**Yüklem dili özyinelemeli değil.** Ölçüm: `{all,any}` nesnesi 978 B, düz `Cond[]` 492 B — JSON Schema'da kardeş `$ref` olmadığı için `Cond` iki kez inline oluyor. `where: Condition[]` + `match: "all"|"any"`; `in` konjonksiyon içi, `match:"any"` tüm-madde ayrıklığını karşılar. İç içe AND/OR ~%2 vaka ve 486 baytlık kalıcı vergi; gerektiğinde iki çağrı.

`contains`/`startsWith`/`endsWith` **yalnız `text` hücrelerde** çalışır — bu `find_in_sheet`'ten bilinçli sapmadır (o hepsini stringleştirir çünkü iğne-samanlık aramasıdır; burada işlem kolon-tiplidir). Metin sıralaması **ordinal**, `localeCompare` değil: host ICU'suna bağlı olurdu, aynı workbook farklı makinede farklı yanıt verirdi — fingerprint sözleşmesiyle bağdaşmaz.

**Grup anahtarları birebir kimliktir.** `İSTANBUL` ve `istanbul` **iki gruptur** — birleştirmek sunucuyu bir yazımı etiket seçmeye zorlar, yani sessiz çakışma çözümü. Ama çakışma `warnings` ile bildirilir. Grup cap'i 50 (hard 500); 512 KB payload cap'i ~13.000 gruba izin verirdi ≈ 150k token, işe yaramaz. Sıralama grup anahtarına göre tür-duyarlı ve eşitlik her zaman anahtarla bozulur — tam sıra. Cursor **yoktur**: top-N + `groupCount` doğru primitiftir ve 20.000 grubu sayfalamak paketin uzaklaştırdığı anti-pattern'dir.

**Kolon indeksi cache'lenmez** (tarama 3 ms, parse 131 ms — 40 kat ucuz; ikinci bir invalidation yüzeyi 3 ms için değmez). **Zaman bütçesi yoktur**: makine yüküne bağlı kesme aynı dosya + aynı argümanın farklı yanıt vermesi demektir. **Hücre bütçesi de yoktur**: kesilmiş tarama **yanlış agregat** üretir ve `truncated: true` etiketli kısmi toplam yavaş çağrıdan tehlikelidir, çünkü ajan sayıyı okuyup bayrağı düşürür. Parse zaten başarılı olduğuna göre **dosya cap'i tarama bütçesidir**.

CSV'de `coerceText` opt-in'dir: `numericTexts` sansürü sayısal metni sayar ve kapalıyken `warnings` bunu söyler. Binlik ayraçlı `"1.234,56"` **reddedilir** — karşılıklı belirsiz, çakışma hatadır. `"007"` `coerceText` açılmadıkça `"007"` kalır.

## 0.2.0 kapsam sınırları

`filter_sheet` ertelendi (iki çağrılık workaround'u var ve cursor cerrahisi gerektiren tek parça o), `median`/yüzdelikler ertelendi (O(satır) bellek isteyen ilk metrik), `caseInsensitiveGroups` ertelendi. Yazma işlemleri, biçimlendirme, chart, pivot, formül değerlendirme ve `.xls`/`.xlsb`/`.ods` hâlâ kapsam dışı.

---

# 0.3.0 düzeltmeleri

Gerçek bir koşu iki kusuru aynı anda gösterdi: bir Ollama ajanı 1146 satırlık bir ERP
çıktısına bağlandı ve **yanlış cevap** üretti. Aşağıdakilerin tamamı o dosyaya ve mevcut
fixture korpusuna karşı ölçüldü.

## `corrupt_workbook` catch-all'ı kalktı

**Ölçüm.** Kök `/Users/kaanakin/Downloads` iken `list_workbooks {"subdirectory":"Downloads"}`
şunu döndürüyordu:

```json
{
  "error": "corrupt_workbook",
  "message": "The workbook could not be read: ENOENT: no such file or directory, scandir '/Users/kaanakin/Downloads/Downloads'",
  "recovery": "Open the file in Excel and re-save it as .xlsx."
}
```

Ortada workbook yoktu; eksik olan bir klasördü. `recovery` ajanı **sağlam bir dosyayı
onarmaya** yolluyordu — 005:151'in "başarısız çağrıyı başarılı bir sonrakine çevirir"
vaadinin tam tersi. Sebep iki katmanlıydı: `paths.ts`'in `readdir`'ü sarmalanmamıştı ve
`asExcelError` her sınıflandırılamayan throw'u `corrupt_workbook`'a eşliyordu.

**Sıra neden bağlayıcı.** `asExcelError`'ın varsayılanını doğrudan değiştirmek gerçek bozuk
dosya tespitini **regresyona uğratırdı**. Ölçüldü: magic-byte kapısını geçen bozuk bir
`.xlsx` için exceljs düz bir `Error` fırlatıyor ve `code` alanı **yok** —

```text
Corrupted zip: can't find end of central directory   (kesilmiş dosya)
Bug : uncompressed data size mismatch                (bit çevrilmiş dosya)
```

Node errno hatalarından ayırt edilebilecek tek yapısal alan `code`; bu hatalarda o alan
bulunmadığı için mesaj dizesine bakmaktan başka yol kalmazdı, ki bu CLAUDE.md'nin yasakladığı
sessiz sihirdir ve JSZip metinleri sürümler arası garantisizdir.

Çözüm ayrımı **yapısal** yapmak: `corrupt_workbook` artık `parseXlsx`'in **içinde** üretiliyor
(`mapXlsxError`), yani alanı bilen katman hatasını kendi sahipleniyor. Bu, `mapCsvError`'ın
CSV tarafında zaten yaptığı şeyin xlsx ikizi; eksik olan simetriydi.

Bu sırayı bozan bir değişikliği **mevcut testler yakalamazdı**: `corrupt.xlsx` fixture'ı düz
metindir ve magic-byte kapısında elenir, `asExcelError`'a hiç ulaşmaz. Bu yüzden
`truncated.xlsx` ve `flipped.xlsx` eklendi — ikisi de kapıyı geçip ayrıştırmada patlar.

**Sonuç.** Sınıflandırılamayan throw `internal_error`; mesaj sandbox kökünden arındırılır,
ham ayrıntı `process.stderr`'e yazılır (stdout MCP taşımasıdır, stderr operatörün kanalı) ve
**`recovery` verilmez** — sınıflandırılamayan bir hata için bilinen bir "sonraki çağrı" yoktur,
dolayısıyla 005:151'in vaadi burada tutulamaz ve tutuluyormuş gibi yapılmaz.

`list_workbooks`'un `readdir`'ü artık `ENOENT` → `file_not_found`, `ENOTDIR` → `not_a_file`
veriyor. Varlık-oracle yasağı (005:131) burada geçerli **değil**: `base` bu noktada zaten
`isContained`'den geçmiştir, yani ispatlanabilir biçimde kök içindedir; yasak kök **dışı**
yollar içindir. Mesajlar çözülmüş mutlak yolu değil çağıranın kendi göreli argümanını
yankılar, `/Downloads/Downloads` katlanması böylece kaybolur.

## Başlık satırı: sezgi değil, kaynak ve ispat

**Ölçüm.** Dosyanın yapısı: satır 1 `A1:G1` birleşik tek başlık bandı, satır 2 boş, satır 3
gerçek başlıklar, satır 4-1146 veri = **1143 satır**. `aggregate_sheet` sonuçları:

| `headerRow`        | `startRow` | `scannedRows` | count  |
| ------------------ | ---------- | ------------- | ------ |
| 1 (varsayılan)     | 2          | 1145          | yanlış |
| 2 (ajanın tahmini) | 3          | 1144          | yanlış |
| 3                  | 4          | 1143          | doğru  |

Yani varsayılan çağrı **iki** satır fazla sayıyordu, ajanın tahmini bir. Kusur veri katmanında
değil, sinyal katmanındaydı: `headerRow` hiçbir zaman sezilmiyordu, yalnızca 1'e varsayılıyordu
ve yanıt bunu söylemiyordu.

**Neden bu 005:73 ile çelişmiyor.** Reddedilen şey sunucunun **sorulmadan ve söylemeden**
karar vermesi. 005:226 sunucunun bir parametreyi yine de hesaplayabileceği koşulları koyuyor
ve paket bunu `delimiter` için zaten sevk etmişti: hesaplama **istenir**, dosyadan
**ispatlanır**, beraberlik **hatadır**, sonuç **kaynağıyla yankılanır**. `headerScan` dördünü
de sağlar ve varsayılanı değiştirmez. `headerRowSource` ise `delimiterSource`'un birebir
karşılığıdır.

**Üç kanıt katmanı, güçlüden zayıfa.**

1. **Beyan.** Sayfada gerçek bir Excel Table (`xl/tables/table1.xml`) varsa başlık satırı
   ölçülmez, **okunur**: `tableRef`'in üst satırı + `headerRow: true`. exceljs bunu okumada
   `worksheet.tables` üzerinden veriyor (`tableRef`, `headerRow`, `columns`), `autoFilter` de
   ikinci bir beyan kaynağı. Bu tahmin değil, dosyanın kendi üstverisi. `headerRowSource`
   `"declared"`.
2. **Tarama.** Beyan yoksa metin kanıtı: bir satır **aday**dır ⟺ diskalifiye eden hücresi yok
   (sayı, tarih, boolean, hata), örten birleşmesi yok, ve en az `min(2, genişlik)` adet
   adlandıran metni var. Başlık satırı penceredeki **ilk aday**dır ve tarama yalnızca
   **ondan sonraki ilk boş olmayan satır aday değilse** başarılıdır. `headerRowSource`
   `"scanned"`.
3. **Varsayım.** Hiçbiri istenmediyse `headerRow` 1'dir ve `headerRowSource` `"default"` —
   ajana satırı **kimsenin seçmediğini** söyleyen tek kelime budur.

**Neden bu kurallar, ölçümle.** Adaylık `typeof value === "string"` ile değil `classify()`'ın
`"text"` türüyle tanımlı, çünkü tarihler ISO string'e serileştiriliyor ve saf-tarih bir satır
aksi halde "hep metin" okunurdu; ayrıca böylece tarama ile agregasyon "başlık nedir" konusunda
yapısal olarak anlaşamamazlık edemez. Kural `naming === filled` değil `disqualifying === 0`,
çünkü `analysis.xlsx!Sales`'in gerçek başlık satırında bir boş string var ve daha katı bir
kural onu yanlışlıkla elerdi. Kural "son aday" değil "ilk aday + sonrası aday değil", çünkü
`turkish.xlsx!Şubeler`'de 1-4 satırların hepsi saf metindir ve naif kural sessizce **4**
çözerdi; doğru cevap orada bir satır seçmek değil, `ambiguous_header_row` ile **reddetmektir**.

**Uyarı yüklemi neden birleşmeye bakmıyor.** Meşru bir grup etiketi (`C1:E1` birleşik
"Quarter 1", `headerRow: 1` doğru) da birleşme kaynaklı `null` üretir. Ayırt edici sinyal
birleşme değil, **tam genişlik boyunca ≤1 non-null string başlık**. Yüklem böylece
birleşmeden bağımsızdır, CSV ile xlsx aynı davranır (005:222 paritesi korunur) ve mevcut
fixture korpusunun tamamında sessizdir.

Uyarı ayrıca "ilk taranan satır başlığa benziyor" biçiminde **kurulamaz**: varsayılan çağrıda
`startRow = 2`'dir ve o satır boştur, yani böyle bir yüklem asıl vakayı kaçırırdı.

## `listWorkbooks` sembolik bağ sızıntısı kapatıldı

**Ölçüm.** Kökün içindeki bir sembolik bağ `subdirectory` olarak verildiğinde, kök **dışındaki**
dosyaların adı, boyutu ve değiştirilme tarihi listeleniyordu:

```json
{
  "files": [
    {
      "filePath": "kacis/gizli-butce.xlsx",
      "sizeBytes": 48308,
      "modifiedAt": "2026-09-07T11:53:12.388Z"
    }
  ]
}
```

İçerik sızmıyordu — aynı dosyayı okumak `resolveWorkbookPath`'in `realpath` adımına takılıp
`path_outside_root` veriyordu. Yani ad/boyut/tarih sızıntısı.

Sebep, iki kod yolunun ayrışması: `resolveWorkbookPath` 005:129'un tarif ettiği zinciri
uyguluyordu (sözlüksel containment → `realpath` → **tekrar** containment), `listWorkbooks` ise
yalnız ilk adımı. Zincirin eksik kalan yarısı listeleme tarafındaydı.

**Kapsam ölçüldü, sanılandan dardı.** Argümansız özyinelemeli tarama zaten güvenliydi —
`readdir`'in `recursive` modu sembolik bağlı dizine girmiyor — ve kökün **kendisi** bağ
olduğunda `createWorkbookRoot` onu zaten `realpath`'liyor. Tek giriş noktası `subdirectory`'nin
bir bağı göstermesiydi.

**Düzeltme.** `listWorkbooks` artık aynı üç adımlı zinciri uyguluyor. Dışarı gösteren bağ
`path_outside_root`; kök içine gösteren bağ **çalışmaya devam ediyor** ve dönen `filePath`
gerçek konumu verdiği için doğrudan tekrar kullanılabilir; kök-symlink kurulumu etkilenmiyor.
`resolveWorkbookPath`'teki gibi tek bir `outside` nesnesi iki yerden fırlatılıyor, böylece
"kök dışında ve var" ile "kök dışında ve yok" ayırt edilemiyor (005:131).

**Bağlı dosyalar da aynı zincire alındı.** `entry.isFile()` sembolik bağlar için `false`
döndüğü için bağlı bir workbook hiç listelenmiyordu — ama kök içinde kaldığı sürece
**okunabiliyordu**. Yani `list_workbooks` okuyabildiği bir dosyayı keşfedilemez kılıyordu, oysa
sandbox'lı bir sunucuda keşfin tek yolu odur. Artık bağlı girdiler de aday sayılıyor,
`realpath` + containment + "hedef gerçekten dosya mı" kontrolünden geçiyor: kök içine bağlı
dosya listeleniyor ve dönen yol okuyucunun kabul ettiği yol; kök dışına bağlı olan ve kırık
olan sessizce eleniyor — hata değil, çünkü listeleme bir filtredir, tek bir girdi yüzünden
çağrının tamamı başarısız olmamalı.

## Workbook parçası olmayan zip

**Ölçüm.** Bir `.docx`'i ya da herhangi bir `.zip`'i `.xlsx` diye yeniden adlandırmak magic-byte
kapısını geçiyor — o kapı yalnız "bu bir zip mi" diye bakar ve OOXML'in tamamı zip'tir. exceljs
`workbook.xlsx.read()` de **hiç fırlatmıyor**: `xl/workbook.xml` bulamayınca sessizce boş bir
workbook döndürüyor. Aynı dosya tool'a göre üç farklı yanlış cevap veriyordu:

| çağrı               | eski sonuç                                                                    |
| ------------------- | ----------------------------------------------------------------------------- |
| `describe_workbook` | `internal_error` — `Cannot read properties of undefined (reading 'date1904')` |
| `read_sheet`        | `unknown_sheet` — "The workbook has no worksheets."                           |

İkisi de yanlış. `unknown_sheet`'in `recovery`'si normalde mevcut sheet'leri listeler ki ajan
doğrusunu seçsin; burada seçilecek sheet **yok ve hiç olmayacak**, yani ajan sonuçsuz bir
"başka sheet dene" döngüsüne giriyordu. `internal_error` ise kusuru sunucuya yıkıyordu, oysa
kusur girdi dosyasında. Doğru olgu tek: zip açıldı, içinde workbook yok.

Not: 0.3.0'ın catch-all düzeltmesi bu tek girdi için raporlanan kodu geçici olarak
**geriletmişti** — önce TypeError catch-all'a düşüp `corrupt_workbook` diyordu, yani doğru kodu
yanlış gerekçeyle veriyordu. Gerekçe düzelince kod bozuldu; aşağıdaki kontrol ikisini birden
düzeltir.

**Yüklem ölçümle seçildi.** `worksheets.length === 0` **yanlış pozitif** verir: exceljs sıfır
sayfalı ama tamamen geçerli bir workbook yazabiliyor (ölçüldü, 5.330 bayt) ve onda
`properties` **var**. Sahte zip'lerde ise `properties` `undefined`. Dolayısıyla ayırt edici tek
başına `properties === undefined`; sayfa sayısına bakılmaz.

| dosya                              | `properties`  | `worksheets` |
| ---------------------------------- | ------------- | ------------ |
| sıfır sayfalı **geçerli** workbook | var           | 0            |
| `.docx` şekilli zip                | **undefined** | 0            |
| yalnız `.txt` içeren zip           | **undefined** | 0            |
| gerçek workbook                    | var           | 1            |

**Düzeltme.** Kontrol `parseXlsx`'in içinde, `read`'den hemen sonra — `mapXlsxError`'ın zaten
durduğu yerde. Her tool aynı `parseXlsx`'ten geçtiği için üç semptom da tek noktada kapanır ve
hepsi `corrupt_workbook` döner. Gerçekten sıfır sayfalı geçerli bir workbook hâlâ
`unknown_sheet` alır, ki o **doğrudur**: o bir workbook'tur, yalnızca sayfası yoktur.

Fixture elle yazılmış bir ZIP'tir (`buildNotAWorkbook`): tek `stored` girdi, `node:zlib`'in
`crc32`'siyle. Testin doğru sebeple geçtiğini `recovery` metni kanıtlar — şekil kontrolünün
metni zip ayrıştırıcısınınkinden farklıdır, yani test bozuk zip'e değil eksik workbook parçasına
bakar.

## Başlık okumasında birleşme politikası

0.3.0'ın ilk turunda `aggregate.ts`'in başlık okumasındaki sabit `mergePolicy: "master"`
**bilinçli olarak korunmuştu**. Gerekçe şuydu: `mergedCells: "repeat"` altında `C1:E1` gibi
yatay bir grup etiketi üç kolona aynı başlığı verir ve `ambiguous_column` doğar, oysa `master`
temiz tek kolon döner; başlık bir etikettir, tekrarlamak yapay çakışma üretir.

**Bu gerekçe yanlıştı ve tek bir şekilden genelleme yapıyordu.** Karşı ölçüm — Excel
raporlarında çok yaygın olan iki satırlı başlık, ilk kolonu dikey birleşmiş:

```text
A1:A2 dikey "Bolge"   B1:C1 "Ceyrek 1"   D1:D2 dikey "Toplam"
                      B2 "Ocak"  C2 "Subat"
```

| çağrı (`headerRow: 2`)       | sonuç                                  |
| ---------------------------- | -------------------------------------- |
| `read_sheet` + `master`      | `[null, "Ocak", "Subat", null]`        |
| `read_sheet` + `repeat`      | `["Bolge", "Ocak", "Subat", "Toplam"]` |
| `aggregate_sheet` + `repeat` | `unknown_column: 'Bolge'`              |

Dikey birleşme **çakışma üretmez** — her kolona farklı başlık verir. `master` orada iki meşru
başlığı `null` yapıp bilgi kaybediyordu, `repeat` ise kurtarıyordu. Ama `aggregate_sheet`
politikayı dinlemediği için ajan `read_sheet`'te gördüğü kolonu agregasyonda bulamıyordu:
**davranışla uyuşmayan üstveri**, yani bu belgenin baştan beri düzelttiği hatanın aynı sınıfı.

Üç ek itiraz, hepsi bu paketin kendi kurallarından:

- Açıkça verilen bir parametrenin yarısının sessizce atılması "sessiz sihir yok" ile çelişir;
  paket `cursor` + `range` çakışmasında hata veriyor, sessiz seçim değil.
- `master`'ın kendisi de bir sessiz çözümdür: yatay `C1:E1`'de sunucu "bu etiket C'nindir" diye
  karar verir, D ve E isimle erişilemez kalır. Bu **"ilki kazanır"**, yani 005:254'ün yinelenen
  başlık için açıkça yasakladığı desen.
- `ambiguous_column` aslında dürüst cevaptır: `repeat` istendiğinde üç kolon gerçekten aynı
  başlığı taşır ve recovery "harfle adresle: B veya C" diyerek çıkışı gösterir.

**Düzeltme.** `mergedCells` başlık okumasına da geçiriliyor. Asıl kusur politika seçimi değil,
`aggregate.ts`'in `read-sheet.ts`'teki döngüyü elle kopyalamış olmasıydı — iki uygulama
kaçınılmaz olarak ayrışır. İkisi de artık `header.ts`'teki tek `readHeaderRow`'u çağırıyor;
`NormalizeOptions` parametre olduğu için her çağıran kendi `valueMode`/`includeHyperlinks`
bağlamını korur, paylaşılan olan yalnız döngüdür.

**Kabul edilen bedel.** Bugün çalışan tek bir çağrı — `repeat` + yatay grup etiketiyle
`groupBy` — artık `ambiguous_column` döner. Takas simetrik değil: bu kombinasyon nadir ve
recovery'siyle kurtarılabilir, karşılığında düzelen iki satırlı başlık şekli yaygın ve şu an
sessizce yanlış. Varsayılan `master` hiç değişmedi, dolayısıyla değişiklik yalnız `repeat`'i
**açıkça isteyen** çağıranı etkiler.

# 0.4.0 eklemeleri

## Grid dışı nesneler: hangi üçü okunabilir, hangi üçü okunamaz

exceljs okuma yolunda tablo, koşullu biçimlendirme, resim, sheet autofilter ve dondurulmuş bölmeleri **zaten parse ediyordu**; hiçbiri ajana ulaşmıyordu. `DeclaredTable` `SheetView.tables`'da duruyor ve tek tüketicisi başlık satırı tespitiydi, `index.ts` export'unda bile değildi. 0.4.0 bu veriyi yayınlıyor: `get_tables`, `get_conditional_formats`, `get_images` ve `SheetSummary`'de altı yeni sayaç. Yeni parse kodu yazılmadı.

Chart, pivot table ve sparkline **okunamıyor** ve bu bir eksiklik değil, tavan:

- Chart: `xlsx.js` `load()` içindeki zip-girdisi dağıtımında `xl/charts/*` ile eşleşen hiçbir dal yok; parça hiç unzip edilmiyor. `xdr:graphicFrame` de çapa xform map'lerinde yok, yani chart'ı barındıran drawing alt-ağacı da sessizce düşüyor. Chartsheet'ler `workbook-xform.js`'te açıkça atlanıyor ("As we don't have the infrastructure to support chartsheets").
- Pivot table: tüm `lib/` ağacında pivot object model'i yok. Geçen iki "pivot" kelimesi alakasız (bir `sheetProtection` boolean'ı ve `styles.xml`'e yazılan kozmetik `defaultPivotStyle` dizesi).
- Sparkline: worksheet `extLst`'inde `x14:sparklineGroups` olarak yaşıyor, ama `ext-lst-xform.js` yalnız `x14:conditionalFormattings`'i map'liyor; diğer her uzantı düşüyor.

Bunlar istendiğinde dönen kod `unsupported_for_format` **değil**, yeni `unsupported_object_kind`. Ayrım kasıtlı: format sorunlu değil — `.xlsx` chart'ı gerçekten taşıyor, okuyucu açamıyor. İkisini birleştirmek ajanı var olmayan bir format farkını aramaya yollar ve `openXlsx`'in "capabilities bloğuna bak, format taşıyamıyor" tavsiyesini yanlış bilgiye çevirir.

## Neden ayrı tool değil, tek enum

Reddetme `get_images`'in `kind` enum'una bağlandı (`picture` | `chart` | `pivotTable` | `sparkline`), `picture` dışındaki her değer `assertPictureKind` ile ve `openXlsx`'ten **önce** reddediliyor — reddetme formdan bağımsız olsun diye.

Böylece boşluk yalnız `listTools()`'tan keşfedilebilir hale geliyor: ajan dört türün varlığını ve üçünün reddedildiğini sıfır round trip'le öğreniyor. Ve `{images: [], count: 0}` — "ölçtüm, yok" diye okunacak sessiz yanıt — o türler için ulaşılamaz.

Reddedilen alternatifler:

- **Daima patlayan ayrı `get_charts` tool'u.** Her ajanın context bütçesinde kalıcı bir slot artı bir tam round trip, tek satır `describe` metni + `capabilities: false` bayrağının bedavaya verdiği bilgi için. Ayrıca register edilmiş tool bir vaattir; yalnız hata verebilen birini register etmek bozulmak üzere verilmiş vaattir.
- **Çalışan `get_images`'i `get_drawings`'e yeniden adlandırmak.** Yapamadığı üç şey için maliyeti çalışan yola yıkıyor.
- **`z.string()` açık parametre.** Keşfedilebilirliği kaybediyor; ajan okunabilir türü şemadan öğrenemiyor.

## Koşullu biçimlendirme: yüklem projeksiyonu

Ajanın koşullu biçimlendirmeye dair sorusu "hangi hücreler işaretli, hangi testle" — asla "dolgunun ARGB'si ne". `ranges + type + operator + formulae + thresholds` birinciyi tam cevaplıyor.

Ölçüm: yalnız düz dolgulu önemsiz bir `cellIs` kuralının `style` nesnesi ~150 karakter; gerçek dashboard kuralları font + dolgu + kenar + numFmt + hizalama ile 400-900 karakter. Yüklem yükünün 10-30 katı, ve bu sunucudaki hiçbir tool renkle iş yapamıyor — `aggregate_sheet`, `find_in_sheet`, `read_sheet` hiçbiri rengi tüketmiyor.

Düşen alanlar ve sebepleri:

- `style` — efekt, yüklem değil. Baskın bayt maliyeti.
- `color` / `color[]` — colorScale gradyan durakları ve dataBar rengi. Sunum.
- `x14Id` — legacy `conditionalFormatting` bloğunu x14 uzantısına dikmek için `mergeConditionalFormattings`'in kullandığı GUID. İç tesisat.
- `dxfId` — styled kurallarda exceljs kendi `reconcile`'ında siliyor; colorScale/dataBar/iconSet'te `undefined` değerli own key olarak kalıyor. Kimse geri eklemesin.
- dataBar'ın dokuz render düğmesi: `minLength`, `maxLength`, `gradient`, `border`, `axisPosition`, `direction`, `negativeBarColorSameAsPositive`, `negativeBarBorderColorSameAsPositive`, `showValue`. dataBar'ın tüm yüklem içeriği cfvo çiftidir, o da `thresholds` olarak korunuyor.
- iconSet `reverse` / `showValue` — sunum. `iconSet` aile adının kendisi **kalıyor**: `3TrafficLights1` ile `5Rating` kova sayısını kodluyor, bu yapısal.

`cfvo` eşikleri **korunuyor** çünkü yapısal içerik onlar: `min` / `max` / `percentile 90` ajana ölçeğin nasıl bölündüğünü söylüyor.

`text` alanı yayınlanmıyor, çünkü **okunabilir değil**. `CfRuleXform.createNewModel` `text` attribute'unu hiç okumuyor; `containsText` kuralında aranan dize yalnız sentezlenmiş `formulae[0]` içinde yaşıyor (`NOT(ISERROR(SEARCH("ACIK",B2)))`). Alanı yayınlamak, okuyucuda olmayan bir yeteneğin reklamı olurdu — formül yükü zaten taşıyor.

**Projeksiyon allow-list olmak zorunda, asla spread.** `cf-rule-xform.js` `createNewModel` her kurala `type, operator, dxfId, priority, timePeriod, percent, bottom, rank, aboveAverage` anahtarlarını **koşulsuz** atıyor; çoğu `undefined` değerli own key olarak duruyor. Ampirik olarak doğrulandı: bir `cellIs` kuralının `Object.keys()`'i dokuz anahtar veriyor, ikisi dolu. `{...rule}` bu yüzden nesneyi tarif etmeyen bir TS tipi üretir ve anahtar temelli her sayımı bozar.

## sqref: tek dize, birden çok aralık

`compressAddresses` burada **kullanılmıyor** ve kimse port etmesin. Yapısal fark: exceljs data validation'ları **hücre başına** saklıyor (`dataValidations.model` adres anahtarlı bir record; `A2:A5000` 4999 girdi), `validations.ts` bu yüzden `stableKey` ile gruplayıp dikdörtgene geri sıkıştırmak zorunda. Koşullu biçimlendirme zaten **aralık başına** saklanıyor: `ref` alanı ham `sqref`, boşlukla ayrılmış çok aralıklı olabilir ve okuma/yazma boyunca aynen korunuyor. Ampirik: `"B2:B20 D2:D20"` tek dize olarak round-trip ediyor. Boşluğa göre split işin tamamı.

Aralık kapağı için yeni sınır uydurulmadı: `maxRangesPerRule` (64) split'ten **sonra**, `validations.ts`'in kullandığı katı `>` karşılaştırmasıyla uygulanıyor. Formül dizeleri de mevcut `maxStringChars` (512) ile `truncateWellFormed` üzerinden kırpılıyor.

## Kural sırası: priority

Düzleştirilmiş kurallar artan `priority` ile sıralanıyor. Excel en küçük numarayı ilk değerlendiriyor, yani priority sırası kuralların **kazanma** sırası — ajan için doğrudan aksiyona dönük bilgi. Yan fayda: `mergeConditionalFormattings` x14-only kuralları listenin sonuna eklediği için blok sırası okuma yoluna bağımlı; priority sıralaması bunu nötrleştiriyor. `priority` taşımayan kural sona gider ve alanı yayılmaz.

## Tablolar: yayınlanan, türetilen ve düşen

`letter` en yüksek değerli türetilmiş alan: ajan başlık metninden tahmin etmek yerine doğrudan `aggregate_sheet`'e A1 harfi verebiliyor. `ref`'in sol-üst kolonundan sayılıyor ve **yalnız parse edilmiş `ref` genişliğine düşerse** yayılıyor — bozuk bir dosyada `tableColumn` sayısı `ref` genişliğini aşarsa, hiçbir yeri adreslemeyen bir harf üretilmemeli.

`autoFilterRef` ile `ref` ayrı ayrı yayınlanıyor çünkü toplam satırı varken farklılaşıyorlar: ampirik olarak `ref: "A1:C4"` iken `autoFilterRef: "A1:C3"`. Bu delta ajana verinin nerede bittiğini söylüyor.

Çıktı sol-üst satır sonra kolona göre sıralanıyor. `Object.entries(worksheet.tables)` insertion order veriyor — pratikte XML `tableParts` sırası, ama sözleşme değil. Sıralama çıktıyı exceljs sürümleri arası deterministik yapıyor ve sheet'i yukarıdan aşağı okur.

Düşen alanlar: `style` (tema dizesi + dört şerit boolean'ı, saf kozmetik), `columns[].dxfId` ve `reconcile`'ın grafladığı `columns[].style`, `rows` (okuma model'inde **hiç yok**), `id`, `target`, ve `totalsRowFormula` / `calculatedColumnFormula` — `TableColumnXform.parseOpen` yalnız `tableColumn`'un kendi attribute'larını okuyor, bu child element'ler sessizce düşüyor. Doc-model'de `totalsRowFormula` getter/setter'ı var ama yalnız yazma içindir.

Üç **yazıcı varsayılanı** değer olarak yayınlanmıyor, çünkü yazarın niyeti değiller:

- `totalsRowFunction: "none"` — exceljs yapılandırılmamış her kolona enjekte ediyor.
- `filterButton: false` — exceljs her kolona yazıyor. Yalnız `true` yayılıyor. Gerçek Excel dosyalarında bu attribute'un **yokluğu** "buton var" demek, yani `false` yayınlamak aşağıdaki `headerRowCount` tuzağıyla aynı sınıfta yanlış bilgi olurdu.
- `totalsRowLabel` — exceljs ilk kolona `"Total"` yazıyor, **toplam satırı olmayan tabloda bile** (ampirik: `totalsRow: false` olan bir tabloda göründü). OOXML'de bu alan yalnız `totalsRowCount=1` iken anlamlı, o yüzden `totalsRow` false ise yayılmıyor.

## exceljs tuzağı: `headerRowCount` eksikse başlık yok sayılıyor

`table-xform.js` `parseOpen` şunu yazıyor:

```js
headerRow: attributes.headerRowCount === '1',
```

ECMA-376'da `CT_Table/@headerRowCount` **1**'e varsayılıyor ve Excel varsayılan durumda attribute'u hiç yazmıyor. JSZip ile `xl/tables/table1.xml`'den `headerRowCount="1"` düşürüldüğünde `table.headerRow === false` geliyor — ölçüldü.

Sonucu: `header.ts` `declaredHeaderRow`, `!table.headerRow` olan tabloları atlıyor. Yani **Excel'in yazdığı tablolarda declared-header tespiti sessizce hiç çalışmıyor**; `headerRowSource: "declared"` yalnız exceljs'in yazdığı dosyalarda ateşliyor. Bugün görünmemesinin sebebi `buildTitleBand` fixture'ını exceljs ile yazmamız, exceljs'in de kendi attribute'unu round-trip etmesi.

### Düzeltme: grid'e sorarak ayırt etmek

`table.headerRow` `get_tables` çıktısında **sadakatle** yayınlanmaya devam ediyor — dosya ne diyorsa o. Ama başlık satırı tespitinde attribute artık tek kanıt değil: iki durum grid'den ayırt edilebiliyor.

Ölçüm, üç durum:

| durum | model `headerRow` | kolon adları | `ref`'in ilk satırı |
| --- | --- | --- | --- |
| `headerRowCount="0"` (gerçekten başlıksız) | `false` | `["c1","c2","c3"]` (sentetik) | `[1,2,3]` (veri) |
| `headerRowCount="1"` | `true` | `["Fatura No",…]` | aynı metinler |
| attribute yok (**Excel'in yazdığı şekil**) | `false` | `["Fatura No",…]` | aynı metinler |

Yani `headerRow: false` dönen iki durumu ayıran şey, tablonun ilan ettiği kolon adlarının `ref`'in ilk satırındaki hücrelerle eşleşip eşleşmediği. `namesTheRowBelow` bunu yapıyor ve karşılaştırma `fold` ile — büyük/küçük harf ve aksan duyarsız, `columns.ts`'in kolon adı eşleştirmesiyle aynı kural.

Politika üç durumlu ve "sessiz çatışma çözümü yok" kuralına bağlı:

- Adların **tamamı** eşleşiyor → başlık satırı fiziksel olarak var, tablo beyanı kabul edilir.
- **Hiçbiri** eşleşmiyor → tablo gerçekten başlıksız, beyan yok sayılır.
- **Kısmen** eşleşiyor → hiçbir şey iddia edilmez, `undefined` dönülür ve akış `scanHeaderRow`'un metin puanlamasına düşer; gerekirse zaten var olan `ambiguous_header_row` ateşler. Yeni bir belirsizlik kategorisi icat edilmedi.

`headerRowCount="1"` açıkça yazılmışsa grid'e hiç bakılmıyor; attribute yeterli kanıt.

`declaredHeaderRow` bunun için bir `mergePolicy` parametresi kazandı — üç çağrı yeri de (`scanHeaderRow`, `headerWarnings`, `tools.ts` `resolveHeader`) politikayı zaten elinde tutuyordu.

### Neden bu bir davranış değişikliği

Düzeltmeden önce `headerRowSource: "declared"` Excel'in yazdığı dosyalarda **hiç** ateşlemiyordu. İki gerçek sonucu vardı.

Birincisi sessiz yanlış cevap. Rapor bandı satır 1'de üç metin hücre taşıyor (merge yok), gerçek tablo satır 3'te. Varsayılan `headerRow: 1` ile `headerWarnings`'in `named > 1` erken çıkışı devreye giriyor, `declared` de `undefined` olduğu için **hiç uyarı üretilmiyordu**: ajan `columns` olarak rapor bandını alıyor, gerçek başlık satırını veri sanıyor, ve sonraki `aggregate_sheet` çağrısı `unknown_column` ile düşüyordu — sebebi görünmeden. Düzeltmeden sonra ilk dal ateşliyor ve gerçek satırı adlandırıyor.

İkincisi hak edilmemiş hata. Aynı dosyada `headerScan: true` çağrısı taramaya düşüyor, satır 1 ve satır 3 ikisi de metin-aday oluyor ve `ambiguous_header_row` atıyordu — oysa dosya cevabı kendi içinde taşıyor. Düzeltmeden sonra tarama hiç başlamıyor.

Üçüncüsü daha sessiz: tarama doğru satırı bulduğu durumlarda bile kaynak `"scanned"` (metin puanlamasıyla tahmin) yerine `"declared"` (dosya ilan etti) olmalıydı; güven derecelendirmesi bir kademe düşük raporlanıyordu.

### Neden test fixture'ları bunu üretemiyor

exceljs'in **yazıcısı** attribute'u her zaman basıyor:

```js
headerRowCount: model.headerRow ? '1' : '0',
```

Yani exceljs ile yazılmış hiçbir fixture bu şekli üretemez ve bug testlerde görünemez. Düzeltmenin testleri bu yüzden xlsx fixture'ı kullanmıyor: `declaredHeaderRow` `SheetView` + `DeclaredTable` üzerinde saf bir fonksiyon, ikisi de düz interface, ve `SheetView.rowAt(row).cellAt(column)` zaten var. Sentetik bir `SheetView` ile altı durum doğrudan test ediliyor — zip erişimi, ham XML veya elle kurulmuş bir xlsx gerekmedi. `compressAddresses`'in saf unit testleriyle aynı tarz.

## exceljs tuzağı: `worksheet.views` `null` olabilir

`index.d.ts` `views`'ı `Array<Partial<WorksheetView>>` beyan ediyor. Runtime `null` veriyor — `<sheetViews>` elementi olmayan her sheet'te, ki bu exceljs'in kendi varsayılan çıktısı (ölçüldü). Guard olmadan `describe_workbook` sıradan bir workbook'ta patlıyordu.

İkinci tuzak: `xSplit` / `ySplit` yalnız `state === "frozen"` altında **sayı**; `state: "split"` altında **nokta** (ölçüldü: `{state:'split', xSplit:2000}` geri okunduğunda `xSplit: 2000`). 2000 dondurulmuş kolon raporlamak saçmalık olurdu, o yüzden bölmeler yalnız frozen view'dan okunuyor.

Ayrıca `Partial<WorksheetView>` bir union olduğu için `xSplit`/`ySplit` her üyede yok; `frozenPanesOf` bu yüzden tek yerelleşmiş cast taşıyor.

## Sayfa sayaçları: neden hücre gezinmesi yok

`SheetSummary` altı alan kazandı: `tableCount`, `conditionalFormatRuleCount`, `imageCount`, `autoFilterRef`, `frozenRowCount`, `frozenColumnCount`. Sözleşme değişmedi: `null` = **format bunu taşıyamaz** (CSV), `0` = xlsx taşıyabiliyor ama yok.

Altısı da sheet seviyeli okuma; hiçbiri `formulaStats`'ın `eachRow` pass'ine katılmıyor. İkisi o pass'e katılsa **aktif olarak yanlış** olurdu:

- `conditionalFormatRuleCount` — bir CF `sqref`'i rutin olarak hiç hücre kaydı olmayan satırları kapsıyor (`buildValidations` tam bu şekli yazıyor: tek dolu hücreli sheet üzerinde `A2:A5000`). `eachRow({includeEmpty: false})` o satırları atlıyor, yani hücre-sayma temelli bir türetme eksik sayar ve aralığı tamamen boş olan bir kural kaybolur.
- `imageCount` — son dolu satırdan sonraya çapalanmış bir resim hem satır gezinmesine hem `usedBounds`'a görünmez. Resimler used range'in parçası değil; çapalar drawing part'ında, sheet verisinde değil.

Bunun görünür sonucu: tek içeriği bir resim olan sheet `usedRange: null, rowCount: 0` ile birlikte sıfır olmayan `imageCount` raporlar. Doğru ve istenen — ama `requireSheetBounds` böyle bir sheet için hâlâ `empty_sheet` atıyor, o yüzden üç yeni handler onu **çağırmıyor**. `get_merged_ranges` ve `get_data_validations` da çağırmıyor.

`describeWorkbook` sheet başına zaten `worksheet.model.merges` ödüyor, bu da tam `Worksheet.model` getter'ını çalıştırıyor. Yeni sayaçlar ikinci bir `.model` erişimi eklemiyor; `worksheet.tables` / `.conditionalFormattings` / `.getImages()` / `.autoFilter` / `.views` doğrudan okunuyor.

## Resimler: çapa, kapsanan aralık ve okunamayanlar

`xdr:to` **dışlayıcı** bir sınır. Ölçüm: `addImage(id, "C3:F8")` geri okunduğunda `br` 0-tabanlı `(col 6, row 8, colOff 0, rowOff 0)` veriyor, yani 1-tabanlı G9. Ham yayınlamak ajana resmin G9'da olduğunu söylerdi.

`nativeColOff` / `nativeRowOff` model'de ve belirsiz değil, o yüzden kapsanan hücre **tam veriden türetme, tahmin değil**: offset 0 ise kenar tam sınıra oturuyor ve o kolon/satır kapsanmıyor, pozitifse resim gerçekten taşıyor ve kapsanıyor. Sol-üstü geçmemesi için clamp ediliyor. Türetme `"C3:F8"` girdisini `"C3:F8"` olarak geri veriyor — doğrulandı. oneCellAnchor'da `range` tek `tl` adresine çöküyor; bunun için `formatRectangle` `validations.ts`'ten `range.ts`'e terfi etti (`formatRange` daima `A1:A1` üretiyor, tek hücreye çökmüyor).

`range` tek A1 dizesi, `from`/`to` çifti değil — bu kod tabanındaki her "sheet üzerinde dikdörtgen" tek A1 dizesi (`merges`, `ValidationRule.ranges`, `usedRange`, tablo `ref`).

`widthPx` / `heightPx` yalnız **oneCellAnchor**'da var olur. `xdr:twoCellAnchor` — Excel'in varsayılan yerleştirmesi, "hücrelerle taşı ve boyutlandır" — XML'de `xdr:ext` child'ı hiç taşımıyor ve `TwoCellAnchorXform`'un map'inde de yok. Yani boyut okunmamış değil, **bilinemez**; genel kullanılabilir bir alan gibi sunmak yanıltıcı olurdu.

`anchor` (`oneCell` | `twoCell`) `br`'nin varlığından türetiliyor ve `editAs` ile **değiştirilemez**: `BaseCellAnchorXform.parseOpen` `editAs`'i twoCellAnchor'lar dahil her çapada `'oneCell'`'e varsayıyor (ölçüldü: iki farklı çapa türü de `editAs: "oneCell"` döndü). `editAs` çapa türü hakkında hiçbir kanıt taşımıyor; ikisi de gerekli ve `editAs` yeniden adlandırılmamalı.

Düşenler: `name` ve `descr` — **parse edilmiyor.** `CNvPrXform.parseClose` `this.model = this.map['a:hlinkClick'].model` yapıyor, `xdr:cNvPr`'nin `id`, `name`, `descr` dahil her attribute'unu atıyor. Daima `undefined` bir `name` yayınlamak, okuyucuda olmayan alt-text desteğinin reklamı olurdu. Ayrıca `nativeColOff` / `nativeRowOff` (hücre-altı EMU; ajanın alacağı karar yok, değerleri `range`'i doğru hesaplamakta), `buffer` (bytes tele çıkmaz; `sizeBytes` dürüst özet) ve `type` (daima `"image"`, `getImages()` zaten filtreliyor — arka plan resimleri bu filtreyle doğru şekilde dışarıda kalıyor).

Bytes `workbook.media`'dan okunuyor, `workbook.model.media`'dan **değil**: `workbook.model` her worksheet'in model'ini kuran pahalı bir getter. `media[i].index` okuma anında atanıyor, yani `image.imageId` `media` dizisine geçerli 0-tabanlı bir index.

## Kesme: iki lehçe neden bir arada

CF **aralıkları** `validations.ts`'in iki seviyeli `rangesTruncated`'ını koruyor (kural başına, artı rapor seviyesinde toplanmış), çünkü aynı ekseni aynı sebeple kesiyorlar.

Kural / tablo / resim **sayıları** standart `truncated` + `truncationReason` + `hint` üçlüsünü kullanıyor, çünkü farklı bir ekseni kesiyorlar. Yeni sınırlar: `maxTablesPerSheet` (64), `maxTableColumns` (256, tablo başına `columnsTruncated` ile), `maxConditionalFormatRules` (200), `maxImagesPerSheet` (200).

Reddedilen alternatif: validations gibi yalnız aralıkları kapmak. Biçimlendirilmiş bir dashboard sheet'i rutin olarak 300+ CF kuralı taşıyor ve yanıtta hiçbir sinyal olmadan `maxPayloadBytes`'ı aşardı. `get_data_validations`'ın bundan kurtulmasının sebebi, hücre başına gruplamanın kural sayısını bir elin parmaklarına indirmesi.

## capabilities: kalıcı olarak false olan üç anahtar

`FormatCapabilities` dokuzdan on beşe çıktı: `tables`, `conditionalFormats`, `images` (xlsx `true`, csv `false`) ve `charts`, `pivotTables`, `sparklines` (**her iki formatta `false`**).

Kalıcı false üç anahtar `describe_workbook` başına ~150 bayta değiyor: **false bayrak, ajanın bir boşluğu başarısız çağrı olmadan öğrendiği tek mekanizma** — bloğun varlığı için zaten yapılan argümanın aynısı.

`capabilities.ts` saf betimleyici kalıyor; `tools.ts` onu runtime'da hâlâ okumuyor, gating elle `loaded.format` üzerinden sürüyor. İkisini birbirine bağlayan şey tip: `capabilities.spec.ts`'in `probes` kaydı `Record<keyof FormatCapabilities, …>` yani **exhaustive** — yeni bir yetenek anahtarı eklenince o kayıt derlenmiyor. Altı anahtar eklendiğinde `check-types` tam bunu yaptı. Blok davranıştan sapamaz.

## Tool register: ad iki yerde, ikincisi derleyiciyle doğrulanıyor

Bu değişiklikten önce bir tool adı **dört** yerde yazılıyordu: `toolDefinitions` anahtarı, `guard` context'inin `tool` alanı, `openXlsx` label argümanı, ve `server.ts`'de elle yazılmış `registerTool` çağrısındaki dize. Tip sistemi yalnız birinciyle handler'lar arasını garanti ediyordu; register bütünlüğünü tek bir runtime testi tutuyordu, `guard` context'indeki bir typo ise hiçbir kontrole yakalanmıyordu.

`server.ts` artık `toolNames` üzerinde tek bir döngü. Kritik nokta ölçülerek bulundu: naif union döngüsü `TS2345` veriyor (`InputArgs` union'ın yalnız ilk üyesinden çıkarsanıyor), ve `registerOne<K extends ToolName>` biçimindeki generic helper de çalışmıyor — generic gövde içinde `K` soyut kalıyor, `ToolCallback<…>` deferred conditional type olarak duruyor ve concrete bir fonksiyon ona atanamıyor; kurtarmak `as unknown as` istiyor, yani helper korelasyonu vaat edip cast'le siliyor. Çalışan biçim tip argümanlarını açıkça vermek: `registerTool<never, ToolInputSchema>`. `Args` naked type parameter olduğu için union **dağılıyor**, yedi concrete callback'e açılıyor, her handler kendi üyesine oturuyor — sıfır assertion.

`guard` `K extends ToolName` ile generic hale geldi ve döndürdüğü fonksiyona `guardedTool: K` brand'i takılıyor (`Object.assign` ile, yani `.d.ts` dürüst ve değer runtime'da denetlenebilir). `K`, `context.tool`'daki düz literal'den ilk çıkarsama turunda sabitleniyor, bu yüzden `args` narrowing'i eskisinden daha sağlam — `read_sheet` handler'ı tek karakter değişmedi. `ToolHandler<K>` isimli alias olmak zorunda: `guard(...): ToolHandlers[K]` biçimi `TS2322` veriyor, çünkü `Object.assign`'ın intersection'ı `K` soyutken mapped type'ın indexed access'ine atanamıyor.

`toolDefinitions` `as const satisfies Record<string, ReadOnlyToolDefinition>` ile kapanıyor. Bundan sonra compile hatası olanlar — hepsi hata enjeksiyonuyla doğrulandı:

- `guard` context'inde yanlış tool adı → `TS2322`, `guardedTool` uyumsuzluğunu ve iki `ToolHandler<…>` instantiation'ını adlandırıyor.
- Bir handler'ı `guard`'sız yazmak → `TS2322`. Yani her tool'un hata sarmalandığı artık tiple garanti.
- `openXlsx` label typo'su → `TS2345`.
- `annotations` eksikliği → `TS2741`; `readOnlyHint: false` → `TS2322`. Paketin read-only vaadi artık bir tip.

Compile-time olmayan iki nokta dürüstçe kayda geçiyor: `toolNames` içindeki `Object.keys(...) as ToolName[]` bir runtime totolojisi ama TypeScript'te ifade edilemiyor, ve döngü içinde `toolDefinitions.read_sheet` + `handlers.find_in_sheet` gibi bir yanlış eşleştirme derleniyor. İkincisi regresyon değil: doğruluk tek `name` ifadesinin tek statement içinde üç kez kullanılmasından geliyor. Register testi bu yüzden **kaldı** ve tel seviyesinde bir `callTool` ile güçlendirildi — refactor sonrası callback SDK'ya tip seviyesi bir union dansıyla ulaştığı için bir uçtan uca çağrı tesisatın gerçek olduğunun en ucuz kanıtı.

Somut kazanç: `get_tables`, `get_conditional_formats` ve `get_images` eklenirken `server.ts` **hiç değişmedi**; dosya artık tek bir tool adı içermiyor.
