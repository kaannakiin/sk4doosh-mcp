import { createPdfjsRasterizer } from "@sk-mcp/pdf-raster-pdfjs";
import { createOllamaOcrProvider } from "@sk-mcp/ocr-ollama";
import type { OcrBinding } from "../src/ocr/port.js";

/**
 * A ready-made binding for `sk-mcp-pdf <root> --ocr <this module>`.
 *
 * Configuration is read from the environment rather than baked in, because the
 * binding is what decides where page images go: whoever runs the server names
 * the host, and the server itself never learns of Ollama.
 */
const binding: OcrBinding = {
  rasterizer: createPdfjsRasterizer(),
  provider: createOllamaOcrProvider({
    baseUrl: process.env["SKMCP_PDF_OCR_URL"] ?? "http://127.0.0.1:11434",
    model: process.env["SKMCP_PDF_OCR_MODEL"] ?? "deepseek-ocr:3b",
    ...(process.env["SKMCP_PDF_OCR_KEEP_ALIVE"] === undefined
      ? {}
      : { keepAlive: process.env["SKMCP_PDF_OCR_KEEP_ALIVE"] }),
  }),
  dpi: Number(process.env["SKMCP_PDF_OCR_DPI"] ?? 200),
};

export default binding;
