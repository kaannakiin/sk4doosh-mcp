import { createOllamaOcrProvider } from "@sk-mcp/ocr-ollama";
import { createPdfjsRasterizer } from "@sk-mcp/pdf-raster-pdfjs";
import { beforeAll, describe, expect, inject, it } from "vitest";
import {
  createDocumentRoot,
  type DocumentRoot,
} from "../src/platform/paths.js";
import { createHandlers } from "../src/tools/handlers.js";
import type { ToolHandlers } from "../src/tools/definitions.js";
import { bodyOf } from "./fixtures/harness.js";

/**
 * Opt-in: this suite needs a reachable Ollama with a vision model, so it is
 * skipped unless SKMCP_PDF_OCR_URL names one. Everything the orchestrator does
 * is covered by ocr.spec.ts against fake ports; what this adds is proof that the
 * two real adapters compose — the rasterizer's PNG is something the model can
 * actually read.
 */
const baseUrl = process.env["SKMCP_PDF_OCR_URL"];
const model = process.env["SKMCP_PDF_OCR_MODEL"] ?? "deepseek-ocr:3b";

describe.skipIf(baseUrl === undefined)(
  "live OCR",
  () => {
    let handlers: ToolHandlers;
    let root: DocumentRoot;

    beforeAll(async () => {
      root = await createDocumentRoot(inject("fixtures").root);
      handlers = createHandlers(root, {
        ocr: {
          rasterizer: createPdfjsRasterizer(),
          provider: createOllamaOcrProvider({ baseUrl: baseUrl ?? "", model }),
          dpi: 200,
        },
      });
    });

    it("transcribes a rendered page well enough to search it", async () => {
      const read = bodyOf(
        await handlers.read_pages({ filePath: "text.pdf", pages: [1] }),
      );
      const pages = read["pages"] as { markdown: string }[];
      expect(pages[0]?.markdown).toContain("2026-0917");
    }, 180_000);
  },
  300_000,
);
