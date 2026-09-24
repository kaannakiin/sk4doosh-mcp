# @sk-mcp/ocr-ollama

An implementation of `@sk-mcp/pdf-mcp`'s `OcrProvider` port, backed by Ollama: it sends a page
image to a vision model and returns the transcribed text. No runtime dependency beyond `fetch`.

## Quick start

```ts
import { createOllamaOcrProvider } from "@sk-mcp/ocr-ollama";

const provider = createOllamaOcrProvider({
  baseUrl: "http://127.0.0.1:11434",
  model: "deepseek-ocr:3b",
});
```

Pair it with `@sk-mcp/pdf-raster-pdfjs` to build a full `OcrBinding` for `pdf-mcp` — see that
package's README and `packages/servers/pdf-mcp/examples/ollama-binding.ts`.

## API

| Export                             | What it does                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `createOllamaOcrProvider(options)` | Builds an `OcrProvider`: `name` is `ollama/<model>`, `recognize(job)` transcribes each rendered page. |

### `OllamaOcrOptions`

| Option      | Default                | Meaning                                                                     |
| ----------- | ---------------------- | --------------------------------------------------------------------------- |
| `baseUrl`   | required               | Ollama host root, without an `/api` suffix (e.g. `http://127.0.0.1:11434`). |
| `model`     | required               | Model name passed to `/api/generate`.                                       |
| `prompt`    | `"<image>\nFree OCR."` | Instruction sent with each page image.                                      |
| `timeoutMs` | `120_000`              | Per-page request timeout.                                                   |
| `headers`   | none                   | Extra HTTP headers merged into the request.                                 |
| `keepAlive` | none                   | Forwarded as Ollama's `keep_alive`.                                         |

## How it plugs into pdf-mcp

`pdf-mcp` defines the `OcrProvider` port in `src/ocr/port.ts` and never imports this package —
the type is declared structurally here (`src/port.ts`) so the dependency graph stays acyclic.
`createOllamaOcrProvider`'s result satisfies that port and is passed as `provider` in an
`OcrBinding`, alongside a `PageRasterizer` such as `@sk-mcp/pdf-raster-pdfjs`. Compile-time
compatibility between this copy of the port and pdf-mcp's real one is pinned by
`pdf-mcp/test/adapters.spec.ts`.

## Rules

- **The prompt was chosen by measurement.** `deepseek-ocr` answers a bare instruction, and
  especially its own `<image>\n<|grounding|>...` format, by mixing bounding boxes like
  `text[[60, 209, 789, 699]]` into the text. `<image>\nFree OCR.` returned the page's text and
  nothing else. Measure your own prompt before switching models.
- **One request per page.** The vision model holds the whole image in context, and Ollama already
  serializes requests per model; batching gains nothing and lets one slow page delay every other
  page's result.
- **HTTP 200 does not mean success.** Ollama returns 200 with an `error` field when the model is
  not found; a status-only check would hand that error text back as the page's content. Every
  outcome is named as a discriminated result: `text`, `refused`, or `unreadable`.
- **An empty transcript is passed through as-is.** Deciding whether that counts as an answer is
  `pdf-mcp`'s call; there, the page stays marked `needsOcr`.
- **`temperature: 0`**, so the same page produces the same text on retry.

## Development

```sh
pnpm turbo run build --filter=@sk-mcp/ocr-ollama
pnpm turbo run test --filter=@sk-mcp/ocr-ollama
```
