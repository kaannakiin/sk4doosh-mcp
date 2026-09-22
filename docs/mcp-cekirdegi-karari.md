# MCP çekirdeği — kaynak-agnostik makinenin ayrılması

**Durum:** uygulandı (F1 hazırlığı) — `packages/cores/mcp-core` yayınlanabilir, `@sk-mcp/file-core` tüketicisi
**Tarih:** 22 Eylül 2026
**Kapsam:** `packages/cores/mcp-core`, `packages/cores/file-core`. `packages/servers/excel-mcp` ve `packages/servers/xml-mcp` bu kararın dışındadır ve **`src/` altında tek satır değişmedi**.
**Kaynak tartışma:** SQL MCP sunucusu (`@sk-mcp/db-core` + `@sk-mcp/mssql-mcp`) planlaması.

## Sorun

Salt-okunur bir SQL sunucusu yazmak için `file-core`'un yanıt makinesine ihtiyaç var: `guard`, `json`,
`toToolError`, yanıt bütçesi, hata zarfı, cursor codec, stdio sunucusu. Bu makinenin hiçbir yerinde
dosya kavramı yok — ama paketin adında, sınıf adlarında ve hata kodlarında var.

Üç seçenek vardı ve üçü de bir bedel taşıyordu:

**Kopyalama.** ~430 satır `db-core`'a taşınır. Bedeli: CLAUDE.md'de yazılı bir kuralla çelişiyor
("`json()` ve `toToolError()` `packages/cores/file-core`'da, yaptırımlı tek yanıt kurucularıdır"), ve
yanıt bütçesine inen bir güvenlik düzeltmesinin iki kez inmesi gerekir. Emsal olarak
`ooxml-core`'un `primitives/text.ts`'i gösterilebilirdi ama o **17 satır**; 430 satır aynı tür karar
değil, paylaşılan bir primitif değil bir fork olurdu.

**`file-core`'a bağlanma.** Tek kopya, gate asla çatallanmaz. Bedeli iki kalem:
`ErrorFactory` code parametresinde contravariant olduğu için `DbErrorCode`, `CoreErrorCode`'u
genişletmek zorunda kalırdı — `path_outside_root`, `file_not_found`, `file_too_large` bir SQL
sunucusunun hata sözlüğüne girerdi. Ve `Vocabulary`'nin `rootLabel` ile `readableLabel` alanları
zorunlu; bir SQL sunucusu onlara anlamsız değer yazmak zorunda kalırdı. Ayrıca `file-core`,
`@sk-mcp/file-core-native`'e bağlı: saf JS bir SQL sunucusu 5 platformluk C++ prebuild taşırdı.

**Çıkarma.** Doğru son hal, ama "üç yayınlanmış paketi kırar" diye elenmişti.

## Karar

Üçüncüsü seçildi: ortak makine `packages/cores/mcp-core`'a çıkarıldı, `file-core` ona bağlandı ve tam
yüzeyini yeniden ihraç ediyor.

Kararı çeviren iki ölçüm:

- **Hiçbir paket npm'de yayınlanmamış.** `@sk-mcp/{file-core,file-core-native,ooxml-core,excel-mcp,xml-mcp}`
  beşi de `E404`. Dış tüketici yok; "üç yayınlanmış paketi kırar" maliyeti mevcut değildi.
- **Tüketicilerin 49 import'unun tamamı barrel'dan.** `excel-mcp` ve `xml-mcp` içinde tek bir derin
  yol import'u yok. `file-core` barrel'ı yeniden ihraç ettiği sürece iki tüketici hiç değişmiyor.

Ayrıca alt grafik zaten temizdi: `tools`, `payload`, `server`, `errors`, `vocabulary`, `limits`,
`unicode` yalnızca birbirini, `zod`'u ve MCP SDK'yı import ediyordu — `file-core-native`'e,
`access.ts`'e ya da `paths.ts`'e hiç dokunmuyordu. Fiilen zaten ayrı bir paketti.

### Bölünme sınırı

`mcp-core`: `errors` (`McpSourceError`, taban `SourceErrorCode`), `unicode`, `payload`, `limits`
(`mcpCoreLimits`), `cursor` (jenerik codec ve içerik damgası), `tools`, `server`
(`createMcpSourceServer`, `serveMcpSourceStdio`), `vocabulary` (asgari üç alan).

`file-core`: dosyaya özgü kalan her şey — `access`, `paths`, `listing`, `documents`, `formats`,
`mode`, `bom`, `cli`, `redactRoot`, `fingerprint(realPath, mtimeMs, size)` — artı üç ince katman:
`CoreErrorCode` tabanı dosya kodlarıyla genişletir, `Vocabulary` üç dosya alanı ekler, `coreLimits`
`mcpCoreLimits`'i yayar.

`FileSourceError extends McpSourceError` zinciri korundu, bu yüzden `SkMcpExcelError` ve
`SkMcpXmlError`'ın `instanceof` davranışı ve `guard()`'ın sınıflandırma kontrolü değişmedi.

### Redaksiyon enjekte edilir

Çıkarmanın tek gerçek kod değişikliği. `toToolError` eskiden sabit olarak
`redactRoot(message, context.root)` çağırıyordu — yol şekilli, `Password=`'e dokunmaz. Kaynak-agnostik
bir çekirdek neyin hassas olduğunu bilemez, o yüzden redaktör `ErrorContext.redact` üzerinden enjekte
ediliyor. `file-core` kök redaktörünü `withRootRedactor` ile bağlıyor; `db-core` sır redaktörünü
bağlayacak.

Bu, `file-core`'a bağlanma senaryosunda **çözülemeyen** problemin ta kendisiydi: bir SQL sunucusu
bağlantı sırlarını hata zarfından silemezdi, çünkü tek redaksiyon yolu yol şekilliydi. Çıkarma onu
yan ürün olarak çözdü.

`GuardContext.fail` de `ErrorFactory<CoreErrorCode>`'dan `ErrorFactory<"resource_limit">`'e
daraltıldı: `guard()` gövdesi o alanı yalnızca `"resource_limit"` ile çağırıyor. Contravariance
nedeniyle daraltma mevcut her çağıranı derlemeye devam ettiriyor, ve tüketicinin hata kodu birleşimini
çekirdeğin kodlarını taşımaya zorlamıyor.

## Doğrulama

- `git diff --stat -- packages/servers/excel-mcp packages/servers/xml-mcp packages/cores/ooxml-core` **boş**. Kabul ölçütü
  buydu: sınır doğru çizildiyse tüketiciler değişmez.
- `pnpm turbo run build check-types lint` dört pakette yeşil.
- `pnpm turbo run test`: `mcp-core` 62, `file-core` 90, `excel-mcp` 430, `xml-mcp` 286 (+4 atlanan).

Testler de bölündü. `payload`, `unicode`, `server`, `payload-gate` ve `cursor`'ın jenerik kısmı
`mcp-core`'a taşındı; `file-core`'da kalan `cursor.spec` yalnızca `fingerprint`'i tutuyor.
`packages/cores/file-core/test/redaction.spec.ts` yeni: `guard`'ın kök redaktörünü gerçekten bağladığını
gerçek transport üzerinden kanıtlıyor. Bu davranış çıkarmadan önce test edilmiyordu ve yeni dikişin
bekçisi o.

## Bilinçli kapsam dışı

- `file-core`'un `0.3.0` sürümü değişmedi. Sürüm artışı yayın gününe bırakıldı; `mcp-core` `0.1.0`
  olarak başladı.
- `cli.ts` (`parseServerArgv`) `file-core`'da kaldı: tek pozisyonel kök argümanı dosyaya özgü. SQL
  tarafı kendi saf ayrıştırıcısını yazacak, çünkü bir bağlantı sırrı argv'de olmamalı.
- `fingerprint(realPath, mtimeMs, size)` çekirdeğe girmedi — dosya metadata'sından kimlik üretiyor.
  `fingerprintFromDigest` ve `contentFingerprint` jenerik oldukları için girdi.

## Reddedilen alternatifler

- **`mcp-core`'u peer dependency yapmak.** `guard()` `instanceof McpSourceError` kontrolü yapıyor ve
  ürün hata sınıfları ondan türüyor; iki çözülmüş kopya bu kontrolü sessizce bozardı — CLAUDE.md'nin
  üç yerde uyardığı zod tuzağının aynısı. Normal dependency olarak monorepo'da tek kopya çözülüyor.
- **`file-core`'u `mcp-core` olarak yeniden adlandırmak.** Dosya katmanı (sandbox, listeleme, belge
  önbelleği, native erişim) gerçek ve büyük; onu kaynak-agnostik çekirdeğin içinde bırakmak SQL
  tüketicisine C++ prebuild taşıtmaya devam ederdi.
