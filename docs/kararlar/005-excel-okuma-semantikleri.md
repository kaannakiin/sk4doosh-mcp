# Karar 005 — Excel Okuma Semantikleri

Tarih: 2026-09-02, 0.2.0 ile genişletildi 2026-09-03. Durum: **kabul edildi, kodla kanıtlandı** ([packages/excel-mcp](../../packages/excel-mcp), 231/231 test, dosya dosya koşuldu).

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

- Header satırı `columns[]`'a hoist edilir, `values`'a girmez. `headerRow` yanıtta echo'lanır — otomatik header sezgisi yok.
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

Magic byte tablosu — bu kontrol olmadan şifreli bir `.xlsx`, unzipper'ın `invalid signature: 0xe011cfd0` mesajıyla patlar; teknik olarak doğru, ajan için tamamen kullanılamaz:

| ilk baytlar               | anlam                                 | kod                  |
| ------------------------- | ------------------------------------- | -------------------- |
| `50 4B 03 04`             | OOXML zip                             | devam                |
| `D0 CF 11 E0 A1 B1 1A E1` | CFB: şifreli OOXML veya legacy `.xls` | `encrypted_workbook` |
| diğer                     | spreadsheet değil                     | `corrupt_workbook`   |

**Bilinen ve kabul edilen açık:** zip bomb (küçük `.xlsx`, gigabaytlık açılım) boyut cap'ini deler; cap sıkıştırılmış dosyayı ölçüyor. Tehdit modeli kullanıcının kendi seçtiği yerel klasör olduğu için v1'de savunulmuyor. Savunma, ZIP merkezi dizinindeki sıkıştırılmamış boyutları exceljs'e vermeden önce okumak olurdu.

## Hata modeli

[packages/core/src/errors.ts](../../packages/core/src/errors.ts) ev stili (`readonly code` ilk parametre, string-literal union, `this.name`), üstüne bir alan: `recovery`.

15 kod, her biri tam olarak bir doğrulama aşamasına karşılık gelir: `invalid_argument`, `path_outside_root`, `unsupported_extension`, `file_not_found`, `not_a_file`, `file_too_large`, `legacy_xls_format`, `encrypted_workbook`, `corrupt_workbook`, `unknown_sheet`, `empty_sheet`, `invalid_range`, `range_outside_used_range`, `invalid_cursor`, `stale_cursor`.

`recovery` bu tasarımın ajan ergonomisi açısından en yüksek kaldıraçlı parçası — başarısız bir çağrıyı yeniden deneme döngüsü yerine başarılı bir sonraki çağrıya çevirir: `unknown_sheet` mevcut sheet'leri **gizli olanlar dahil** listeler (göremediğini isteyemez), `invalid_range` sheet'in gerçek used range'ini söyler, `file_not_found` `list_workbooks`'a yönlendirir.

Yüzeyleme: **`isError: true` + yapılandırılmış JSON gövde**, throw ederek değil.

- `isError: true`, çıplak sonuç değil: `SkMcpMetaTools`'un `isError`'sız `{error,message}` deseni orada doğru — 403 `invoke_tool`'un meşru sonucudur. Burada `unknown_sheet` "hiçbir şey okunmadı" demek. İstemciler `isError: true`'yu başarısız çağrı olarak gösterir ve model bunu "farklı dene" diye işler; referansın düz `"Error: <msg>"` metni ise içeriği "Error" olan bir hücreden ayırt edilemez.
- Throw edilmiyor, çünkü MCP SDK yakalayıp `createToolError(error.message)` üretiyor — **`code` alanı siliniyor**. Makine-okunur sözleşme handler sınırında catch gerektirir; `asExcelError` bilinmeyen throw'ları `corrupt_workbook`'a eşler.
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

Birleşik `query_sheet` (metrics yoksa satır, varsa agregat) ölçüldü — 872 vs 1.659 token, %47 tasarruf — ve **reddedildi**: mod anahtarı dönüş şeklini sessizce değiştirir, `outputSchema` yok, ajan tek ad altında iki şekil taşımak zorunda kalırdı. `headerRow`'u otomatik sezmeyi reddeden paket bunu da reddeder. `sort_sheet` kalıcı olarak düştü (limitsiz sıralama sayfalamanın süslüsü). `profile_columns` düştü: kolon sansürü **etkilediği agregatın yanına** iliştirilir, ayrı çağrıya değil, ve ön-keşif `unknown_column`'ın recovery'sinden bedavaya gelir.

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
