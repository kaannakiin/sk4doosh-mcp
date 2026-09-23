# Çıktı yazan tool türü — `mcp-core`'da salt-okunur olmayan ilk tür

**Durum:** uygulandı (llm-mcp F0) — tip ve kayıt fonksiyonu `mcp-core`'da, diske yazan kod yok
**Tarih:** 23 Eylül 2026
**Kapsam:** `packages/cores/mcp-core` (`tools.ts`, `server.ts`, `index.ts`). `packages/cores/file-core`, `packages/cores/db-core` ve `packages/servers/*` bu kararın dışındadır ve **tek satır değişmedi**.
**Kaynak:** [llm-mcp-plani.md](llm-mcp-plani.md), `local_map` tool'u.

## Sorun

`local_map` bir CSV'nin her satırını etiketliyor ve sonucu codex'e değil diske yazıyor. Codex satırların tamamını görmüyor,
yalnızca dosyanın yolunu, sayımları ve etiket başına örnekleri görüyor. Tablo işinde yerel modelin kazancı da bu
(plan, kural 12-13).

`mcp-core` bugün yalnızca salt-okunur tool kabul ediyor:

- `ReadOnlyToolDefinition.annotations.readOnlyHint` literal `true`.
- `ToolDefinitions = Readonly<Record<string, ReadOnlyToolDefinition>>`.
- `guard`, `HandlersOf` ve `createMcpSourceServer` hepsi `D extends ToolDefinitions`.

Yazan bir tool'a `readOnlyHint: true` demek yalan olurdu. Codex `default_tools_approval_mode = "auto"` ile annotation'a bakıp
onay veriyor (plan, kural 1): yanlış annotation, onaysız yazma demek.

## Karar

`mcp-core`'a ikinci bir tür eklendi: **yalnızca sunucunun kendi çıktı klasörüne yeni dosya ekleyen tool**.

| Tip / değer               | Ne                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `OwnOutputToolDefinition` | `annotations`'da `readOnlyHint: false` ve `destructiveHint: false` zorunlu. `destructiveHint` hiç yazılmazsa da kabul edilmez             |
| `ownOutput`               | Hazır annotation: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false` (her çağrı yeni dosya), `openWorldHint: false` |
| `ToolCatalog`             | `ReadOnlyToolDefinition \| OwnOutputToolDefinition` kaydı. `readOnlyHint` literal'i birliği ayırıyor                                      |
| `createMcpOutputServer`   | `ToolCatalog` alan kayıt fonksiyonu. Yazan tool'un sunucuya girdiği **tek** yol                                                           |

Değişmeyenler:

- `ToolDefinitions` salt-okunur kaldı. excel/xml/pdf/mssql'in `satisfies ToolDefinitions`'ı yazan tanımı hâlâ reddediyor.
- `createMcpSourceServer`'ın imzası aynı (`D extends ToolDefinitions`). İçeride ikisi de aynı özel `buildServer`'ı çağırıyor.
- `guard`, `HandlersOf`, `GuardedHandler`, `ToolNameOf`, `ToolInputOf` ve `toolNamesOf`'un kısıtı `ToolCatalog`'a genişledi.
  Bu geriye uyumlu: `ToolDefinitions` ⊂ `ToolCatalog`, mevcut her örnekleme geçerli. Payload bütçesi ve hata zarfı yazan tool'a
  da aynen uygulanıyor. `HandlersOf` hâlâ yalnızca `guard()` çıktısını kabul ediyor.

### Opt-in nasıl sağlanıyor

Yeni semboller yalnızca `@sk-mcp/mcp-core` barrel'ında. `file-core` ve `db-core` bunları **yeniden ihraç etmiyor**. CLAUDE.md'ye göre
her ürün sunucusu tek bir çekirdeği adlandırıyor. Bu yüzden excel/xml/pdf (`file-core`) ve mssql (`db-core`) yazan türe erişemiyor.
Onların `createFileSourceServer`/`createMcpSourceServer`'ı salt-okunur kısıtı taşıyor. Yazan türü isteyen sunucu doğrudan
`@sk-mcp/mcp-core`'a bağlanır ve bu manifest'te görünür.

### Tüketicinin sözleşmesi

Çekirdek diske yazmıyor: fs bilmiyor ve "file"/"path" literal'i taşıyamıyor. `ownOutput` annotation'ı bir vaat. Vaadi
tüketici tutuyor, ve llm-mcp F3'te şu dört kural uygulanır:

1. **Tek klasör.** Yazma yalnızca sunucunun çıktı klasörüne yapılır (varsayılan `.llm-mcp/out/`, `SKMCP_LLM_OUTPUT_DIR`). Çözülmüş yol
   klasörün dışına çıkarsa istek reddedilir.
2. **Yalnızca yeni dosya.** Açma `wx` bayrağıyla yapılır. Var olan dosyanın üzerine yazılmaz, hiçbir dosya silinmez.
3. **Adı sunucu seçer.** Tool girdisinde hedef yol yok. Model çıktısı veya kullanıcı verisi dosya adına ya da konumuna karar veremez.
   Örneğin alt klasöre `AGENTS.md` bırakıp codex'e talimat verme yolu böylece kapanır.
4. **Yolu döner.** Yanıt dosyanın workspace'e göreli yolunu, sayımları ve örnekleri taşır. Dosyanın tamamını taşımaz.

## Doğrulama

- `pnpm turbo run build check-types lint --filter=...@sk-mcp/mcp-core` yedi pakette yeşil (mcp-core, file-core, db-core,
  excel-mcp, xml-mcp, pdf-mcp, mssql-mcp).
- `git diff --stat -- packages/servers packages/cores/file-core packages/cores/db-core` **boş**.
- `packages/cores/mcp-core/test/output-server.spec.ts` yeni:
  - **Tip seviyesi** (`expectTypeOf`, `check-types` ile koşuyor). Yazan tanım `ToolDefinitions`'a ve `createMcpSourceServer`'ın
    parametresine uymuyor, `createMcpOutputServer`'ınkine uyuyor. `destructiveHint: true` ve `destructiveHint`'siz tanım
    `ToolCatalog`'a uymuyor. Karışık katalogda her tool'un girdisi doğru çıkarılıyor. İddialar ters çevrildiğinde
    `check-types` kırılıyor, yani ölü değiller.
  - **Transport üzerinden:** iki tür annotation'ını tel üzerinden taşıyor. Yazan tool'un 600 KB'lık yanıtı `resource_limit` zarfına
    düşüyor.

## Bilinçli kapsam dışı

- **Diske yazan kod.** Yukarıdaki dört kural llm-mcp F3'te, sunucunun tek bir klasöründe ve lint ile sınırlı olarak uygulanır.
- **Var olanı değiştiren ya da silen tür.** `destructiveHint: true` bir tool hiçbir katalog tipine uymuyor. İhtiyaç çıkarsa ayrı karar.
- **`openWorldHint`.** `ownOutput` `false` diyor. Tanım yalnızca `readOnlyHint` ve `destructiveHint`'i zorunlu tutuyor: arkasında
  açık bir ağ kaynağı olan bir tüketici kendi annotation'ını yazabilir.

## Reddedilen alternatifler

- **`ToolDefinitions`'ı genişletmek.** Tek tip kalırdı, ama excel/xml/pdf/mssql'in `satisfies ToolDefinitions`'ı yazan tanımı sessizce
  kabul etmeye başlardı. "Açıkça seçen" koşulu kaybolurdu.
- **`createMcpSourceServer`'ın kısıtını genişletmek.** `file-core` onu `createFileSourceServer` olarak yeniden ihraç ediyor. Yazan tür
  dosya sunucularına bu yoldan sızardı.
- **Annotation'a `unique symbol` markası.** Annotation'lar JSON olarak tele çıkıyor, symbol anahtarı düşer. Ayrıca markayı taşımayan
  düz bir nesne yine yapısal olarak uyar, marka opt-in'i zorlamaz.
- **Yazıcıyı `mcp-core`'a koymak.** Çekirdeğin çalışma zamanı bağımlılığı yok ve kaynak kelimesi taşıyamıyor. Yol çözümü ve kök
  redaksiyonu zaten `file-core`'un işi. Yazıcı tüketicide, vaadin sahibinin yanında kalır.
