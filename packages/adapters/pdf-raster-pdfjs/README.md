# @liaiso/pdf-raster-pdfjs

An implementation of `@liaiso/pdf-mcp`'s `PageRasterizer` port, backed by pdf.js: it renders a
PDF page to PNG. The server never names this package; whoever wires the binding injects it.

## Quick start

```ts
import { createPdfjsRasterizer } from "@liaiso/pdf-raster-pdfjs";

createPdfMcpServer(root, {
  ocr: { rasterizer: createPdfjsRasterizer(), provider, dpi: 200 },
});
```

Pair it with `@liaiso/ocr-ollama` to build a full `OcrBinding` for `pdf-mcp` — see that package's
README and `packages/servers/pdf-mcp/examples/ollama-binding.ts`.

## API

| Export                           | What it does                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `createPdfjsRasterizer(options)` | Builds a `PageRasterizer`: `render(job)` renders each requested page to a PNG `RenderedPage`. |

### `PdfjsRasterizerOptions`

| Option      | Default | Meaning                                              |
| ----------- | ------- | ---------------------------------------------------- |
| `maxPixels` | `4000`  | Upper bound on either rendered dimension, in pixels. |

## How it plugs into pdf-mcp

`pdf-mcp` defines the `PageRasterizer` port in `src/ocr/port.ts` and never imports this package —
the type is declared structurally here (`src/port.ts`) so the dependency graph stays acyclic and
`pdf-mcp` can devDepend on this package without a cycle. `createPdfjsRasterizer`'s result
satisfies that port and is passed as `rasterizer` in an `OcrBinding`, alongside an `OcrProvider`
such as `@liaiso/ocr-ollama`. Compile-time compatibility between this copy of the port and
pdf-mcp's real one is pinned by `pdf-mcp/test/adapters.spec.ts`.

## Rules

- **Dependency versions are exact-pinned, no caret.** pdf.js 5 together with `@napi-rs/canvas`
  1.x fails at `ctx.fill(path)` with `Value is none of these types String, Path` the moment the
  first glyph is drawn. The measured working pair is `pdfjs-dist@4.10.38` +
  `@napi-rs/canvas@0.1.100`. Re-measure before moving either pin; `check-npm-tarballs.py` checks
  that both stay pinned.
- **`standardFontDataUrl` is required.** Without it, pdf.js skips every glyph of a non-embedded
  font: the page comes back the right size, error-free, and **blank**. An OCR model would
  faithfully report that as "empty page" — a silent wrong answer.
- **The page is painted white.** A PDF page has no background of its own; an unfilled canvas
  stays transparent and flattens to black in the PNG.
- **Page numbers are 1-based**, matching the port's surface. An out-of-range request is refused.
- **A `maxPixels` ceiling bounds the image** regardless of how high `dpi` is set (default 4000
  px).

## Development

```sh
pnpm turbo run build --filter=@liaiso/pdf-raster-pdfjs
pnpm turbo run test --filter=@liaiso/pdf-raster-pdfjs
```
