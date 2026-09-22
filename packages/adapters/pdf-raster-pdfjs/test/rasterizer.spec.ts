import { describe, expect, it } from "vitest";
import { createPdfjsRasterizer } from "../src/rasterizer.js";
import { textPdf } from "./fixture.js";

const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const document = textPdf([["First page"], ["Second page"], ["Third page"]]);

describe("rendering", () => {
  it("returns one PNG per requested page, in the order asked", async () => {
    const rendered = await createPdfjsRasterizer().render({
      bytes: document,
      pages: [3, 1],
      dpi: 100,
    });
    expect(rendered.map((page) => page.page)).toStrictEqual([3, 1]);
    for (const page of rendered) {
      expect(page.mediaType).toBe("image/png");
      expect(Buffer.from(page.image).subarray(0, 4)).toStrictEqual(pngMagic);
      expect(page.image.byteLength).toBeGreaterThan(1000);
    }
  });

  /**
   * Without pdf.js's standard font data every glyph of a non-embedded font is
   * skipped and the page renders blank, with no error. This pins that the
   * fixture's Helvetica text actually puts ink on the canvas: a blank page is
   * the failure mode an OCR model would faithfully report as an empty page.
   */
  it("draws non-embedded standard fonts rather than a blank page", async () => {
    const [plain] = await createPdfjsRasterizer().render({
      bytes: textPdf([[" "]]),
      pages: [1],
      dpi: 100,
    });
    const [written] = await createPdfjsRasterizer().render({
      bytes: textPdf([["TEXT THAT MUST BE VISIBLE ON THE PAGE"]]),
      pages: [1],
      dpi: 100,
    });
    expect(written?.image.byteLength).toBeGreaterThan(
      (plain?.image.byteLength ?? 0) + 200,
    );
  });

  it("scales with dpi", async () => {
    const raster = createPdfjsRasterizer();
    const [low] = await raster.render({ bytes: document, pages: [1], dpi: 72 });
    const [high] = await raster.render({
      bytes: document,
      pages: [1],
      dpi: 200,
    });
    expect(high?.image.byteLength).toBeGreaterThan(low?.image.byteLength ?? 0);
  });

  it("caps the rendered size however high the dpi goes", async () => {
    const raster = createPdfjsRasterizer({ maxPixels: 200 });
    const [page] = await raster.render({
      bytes: document,
      pages: [1],
      dpi: 4000,
    });
    expect(page?.image.byteLength).toBeLessThan(60_000);
  });
});

describe("refusals", () => {
  it.each([[0], [-1], [4], [1.5]])("refuses page %s", async (page) => {
    await expect(
      createPdfjsRasterizer().render({
        bytes: document,
        pages: [page],
        dpi: 100,
      }),
    ).rejects.toThrow();
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createPdfjsRasterizer().render({
        bytes: document,
        pages: [1],
        dpi: 100,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/i);
  });

  it("refuses bytes that are not a PDF", async () => {
    await expect(
      createPdfjsRasterizer().render({
        bytes: Buffer.from("not a pdf"),
        pages: [1],
        dpi: 100,
      }),
    ).rejects.toThrow();
  });
});
