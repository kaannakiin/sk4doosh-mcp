# @sk-mcp/docs

sk-mcp dokümantasyon sitesi. TanStack Start (Vite) + Mantine + Tailwind CSS.

```bash
pnpm --filter @sk-mcp/docs dev     # http://localhost:5180
pnpm turbo run build --filter=@sk-mcp/docs
```

## İçerik

Sayfalar `src/content/<ürün>/<mod>/*.md` altında; yapı iki eksenli (ürün hattı × Diátaxis modu).
Dosya adı sırayı ve slug'ı, ilk `#` satırı başlığı verir
(`http-catalog/00-introduction.md` → `/docs/http-catalog/introduction`). Sidebar
`src/lib/content.ts` tarafından otomatik üretilir; ürün listesi `src/content/products.json`'dan
gelir.

Yapısal kuralları `pnpm --filter @sk-mcp/docs validate` zorlar (mod klasör adları, ürün kaydı,
tekil slug, `# Title`, site içi link hedefleri). `pnpm lint` bunu da koşar.

Site içeriği ve arayüz metinleri **İngilizce** yazılır — site sk-mcp'nin public yüzü. Repo
kökündeki `docs/` (iç tasarım dokümanları) Türkçe kalır; `packages/spec/` İngilizcedir çünkü site
ona normatif kaynak olarak link verir. i18n katmanı yok: tek dil, drift yok.

## Stil katmanları

`src/styles/app.css` katman sırasını sabitler:

```css
@layer theme, base, components, mantine, utilities;
```

Tailwind preflight (`base`) Mantine'den önce gelir, yani Mantine component stillerini ezmez;
Tailwind utility'leri (`utilities`) Mantine'den sonra gelir, yani `<Button className="mt-4">`
çalışır. Bu yüzden `@mantine/core/styles.layer.css` import edilir — `styles.css` ile ikisi
birden asla import edilmez.

## Üretilmiş dosya

`src/routeTree.gen.ts` TanStack Router tarafından üretilir ve depoya commit edilir; `check-types`
görevi `build`'e bağlı olmadığı için temiz bir checkout'ta hazır bulunması gerekir.
