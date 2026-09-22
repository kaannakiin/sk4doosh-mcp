# @sk-mcp/pdf-raster-pdfjs

`@sk-mcp/pdf-mcp`'nin `PageRasterizer` portunun pdf.js tabanlı uygulaması: PDF sayfasını PNG'ye
çevirir. Sunucu bu paketi adlandırmaz; bağlayan kişi enjekte eder.

```ts
import { createPdfjsRasterizer } from "@sk-mcp/pdf-raster-pdfjs";

createPdfMcpServer(root, {
  ocr: { rasterizer: createPdfjsRasterizer(), provider, dpi: 200 },
});
```

## Bağlayıcı kurallar

- **Sürümler exact-pin, caret yok.** pdf.js 5 ve `@napi-rs/canvas` 1.x birlikte, ilk glif çizildiği
  anda `ctx.fill(path)` üstünde `Value is none of these types String, Path` ile patlıyor. Ölçülen
  çalışan çift `pdfjs-dist@4.10.38` + `@napi-rs/canvas@0.1.100`. Pin'i oynatmadan önce yeniden ölç;
  `check-npm-tarballs.py` ikisini de doğruluyor.

- **`standardFontDataUrl` zorunlu.** Verilmezse pdf.js gömülü olmayan fontların her glifini atlıyor:
  sayfa doğru boyutta, hatasız ve **boş** çıkıyor. Bir OCR modeli bunu sadakatle "boş sayfa" diye
  rapor eder — sessizce yanlış cevap.

- **Sayfa beyaza boyanır.** PDF sayfasının kendi arka planı yoktur; doldurulmazsa canvas saydam
  kalır ve PNG'de siyaha düşer.

- **Sayfa numaraları 1 tabanlı**, port'un yüzeyiyle aynı. Aralık dışı istek reddedilir.

- **`maxPixels` tavanı** dpi ne kadar yükselirse yükselsin görüntüyü sınırlar (varsayılan 4000 px).

Port tipleri buraya yapısal olarak kopyalanmıştır (paket hiçbir `@sk-mcp/*` paketi adlandırmaz,
grafik döngüsüz kalır). Kopyanın sapmadığını `pdf-mcp/test/adapters.spec.ts` derleme zamanında
pinler.
