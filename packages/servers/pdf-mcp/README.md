# @sk-mcp/pdf-mcp

Yerel PDF belgelerini okuyan, salt-okunur, sandbox'lanmış bir MCP sunucusu. `@sk-mcp/file-core`
üzerine kuruludur: sandbox yol çözümü, yanıt bütçesi, hata zarfı, cursor ve belge önbelleği oradan
gelir. Metin çıkarımı `@firecrawl/pdf-inspector` ile yapılır. Sunucu **hiçbir zaman ağa çıkmaz**:
OCR gerekiyorsa iki port enjekte edilir ve bağlantı kararı tamamen onları bağlayana aittir.

## Kurulum

```json
{
  "mcpServers": {
    "pdf": {
      "command": "npx",
      "args": ["-y", "@sk-mcp/pdf-mcp", "/belgelerin/olduğu/klasör"]
    }
  }
}
```

## Bu sürümde ne var

| Tool                | Ne yapar                                                                  |
| ------------------- | ------------------------------------------------------------------------- |
| `list_documents`    | Kökün altındaki PDF adaylarını listeler; hiçbir dosyayı açmaz             |
| `describe_document` | Sayfa sayısı, belge türü, sayfa sayfa OCR ihtiyacı, sunucunun yetenekleri |
| `read_pages`        | Seçilen sayfaları Markdown olarak okur; sayfa numaraları korunur          |
| `find_in_document`  | Çıkarılmış metinde literal arama; sayfa numarası ve eşleşme bağlamı       |

Dosya yolu biliniyorsa `describe_document` zorunlu değildir: `read_pages` ve `find_in_document`
yalnız `filePath` ile çalışır.

## OCR

Sunucu OCR _yapmaz_, OCR'ı _destekler_. İki port enjekte edilir; ne raster kütüphanesi ne de model
istemcisi bu paketin bağımlılığıdır — `db-core`'un hiçbir sürücü adlandırmamasıyla aynı duruş.

```ts
interface PageRasterizer {
  render(job: {
    bytes: Buffer;
    pages: readonly number[];
    dpi: number;
    signal?: AbortSignal;
  }): Promise<readonly RenderedPage[]>; // { page, image, mediaType }
}

interface OcrProvider {
  readonly name: string;
  recognize(job: {
    pages: readonly RenderedPage[];
    signal?: AbortSignal;
  }): Promise<readonly RecognizedPage[]>; // { page, markdown, confidence? }
}
```

Sunucu yalnız şunu yapar: metin katmanının cevaplayamadığı sayfaları `render` eder, çıkan görüntüleri
`recognize` eder, sonucu o sayfanın yerine koyar ve `source: "ocr"` olarak işaretler.

```ts
createPdfMcpServer(root, {
  ocr: { rasterizer: poppler, provider: ollama, dpi: 200 },
});
```

Ollama sağlayıcısı bu kadar:

```ts
const ollama: OcrProvider = {
  name: "ollama/llama3.2-vision",
  recognize: ({ pages }) =>
    Promise.all(
      pages.map(async (page) => {
        const response = await fetch("http://127.0.0.1:11434/api/generate", {
          method: "POST",
          body: JSON.stringify({
            model: "llama3.2-vision",
            prompt: "Transcribe this page as Markdown.",
            images: [Buffer.from(page.image).toString("base64")],
            stream: false,
          }),
        });
        const { response: markdown } = await response.json();
        return { page: page.page, markdown };
      }),
    ),
};
```

Raster tarafı için en ucuz seçenek poppler'ın CLI'ı (`pdftoppm -png -r <dpi> -f <n> -l <n>`); native
bağımlılık gerektirmez.

### OCR'da bağlayıcı olanlar

- **Sağlayıcı yoksa `ocr: true` hatadır** (`ocr_unavailable`), sessizce metin katmanına düşmez.
  Aksi halde OCR isteyen bir ajan, kimsenin çevirmediği bir belgeden "eşleşme yok" cevabını kesin
  sanardı. `describe_document` → `capabilities.ocr` bağlı olup olmadığını söyler.
- **Boş transkripsiyon cevap sayılmaz.** Sağlayıcı boş metin döndürürse sayfa `needsOcr` kalır —
  "model bir şey döndürmedi" ile "bu sayfa boş" aynı şey değil.
- **İstenmeyen sayfa yok sayılır.** Portlar sırayı bozabilir, sayfa atlayabilir, olmayan sayfa
  uydurabilir; sonuçlar istenen sayfa numarasına göre eşleştirilir, böylece bir sağlayıcı metin
  katmanı güvenilir olan bir sayfanın üzerine yazamaz.
- **Byte'lar süreçten çıkar.** Bir sağlayıcı bağlamak, o sayfaların piksellerinin dışarı gitmesi
  demektir. Bu yüzden varsayılan kapalı ve her çağrıda açıkça isteniyor.
- **Sayfa başına tekrar ödenmez.** Transkripsiyon belge damgası + sayfa numarasıyla önbelleklenir.
  Önbellek ilerleme kaydı değildir: arama yalnız cursor'dan sonraki sayfaları OCR'a verir ve
  kapsamayı cursor içinde taşır, böylece önbellekten büyük bir belge de sonuna kadar gezilir.
- **Süresi dolan iş slotunu bırakmaz.** Motor da portlar da başlamış işi iptal edemez; slot iş
  gerçekten bitene kadar dolu kalır. Hiç dönmeyen bir sağlayıcının slotunu yalnız sunucuyu yeniden
  başlatmak geri alır — zamanla iade, sınırı yalnızca ertelerdi.

## Bağlayıcı kurallar

- **Dış yüzeydeki her sayfa numarası 1 tabanlıdır.** Kütüphane aynı sonuç nesnesinde bazı alanları
  0, bazılarını 1 tabanlı veriyor. Dönüşümün tamamı `src/engine/` içindedir ve lint,
  `@firecrawl/pdf-inspector` import'unu o klasör dışında yasaklar — ikinci bir import noktası bu
  hatayı geri getirirdi (1.23.0'da ölçüldü: `PageMarkdownResult.page` 0, kardeş `pagesNeedingOcr` 1
  tabanlı).

- **Sayfa seçimi kütüphaneye gitmeden doğrulanır.** Aralık dışı bir indeks hata değil, `needsOcr`
  işaretli hayalet bir sayfa döndürüyor; negatif değer u32'ye sarıyor. İkisi de ajana gerçek sayfa
  gibi görünürdü.

- **`describe_document` OCR sayfa listesini sınıflandırıcıdan üretmez.** `classifyPdf`, içinde tek
  bir taranmış sayfa olan belgenin bütün sayfalarını işaretliyor. Liste sayfa sayfa çıkarımdan gelir.
  `classificationConfidence` sınıflandırıcının kendi hükmüne güvenidir — metnin doğruluk skoru değil.

- **Okunamayan sayfa boş sayfa gibi sunulmaz.** Taranmış sayfa `needsOcr: true` ile döner; `empty`
  yalnız motorun güvendiği ve gerçekten boş bulduğu sayfa için `true`'dur.

- **Arama kapsamı her yanıtta bildirilir.** OCR gerektiren sayfa varsa `coverageComplete` `false`
  olur ve boş bir eşleşme listesi belgenin tamamı için kesin sonuç sayılmaz.

- **Belge bir kez bütün çıkarılır, yanıt sayfalanır.** Ölçüm, tek sayfa istemenin maliyeti 200'de 1
  değil 3'te 1 düşürdüğünü gösterdi; sabit maliyet baskın. Cursor kimliği belge içeriğine ve `ocr`
  moduna bağlıdır, sayfa boyutuna değil. Açık `pages` seçimi de devam eder: cursor seçimin kalanını
  taşır, seçilmemiş sayfaya geçmez. Sayfa içinden devam eden cursor o sayfanın metin özetini taşır;
  metin yeniden transkripsiyonla değiştiyse `stale_cursor` döner, içerik sessizce atlanmaz.

- **Sunucu ağa çıkmaz.** `fetch`, `node:http`, `node:net` ve kardeşleri `src/` içinde lint ile
  yasaklıdır ve yasak her katmana ayrı ayrı dokunmuştur — oxlint'te sonraki bir override
  `no-restricted-imports`'u birleştirmeden eziyor, tek bir blok sessizce uygulanmaz hale gelirdi.

- **Platform desteği dar.** Motor `darwin-x64` binary'si yayımlamıyor ve wasm fallback'i yayımlanmamış.
  Desteklenmeyen bir hostta sunucu tek satırlık bir mesajla başlangıçta durur (çıkış kodu 3).

## Çalıştırma

```sh
pnpm turbo run build --filter=@sk-mcp/pdf-mcp
node packages/servers/pdf-mcp/dist/cli.js /belgelerin/olduğu/klasör
```
