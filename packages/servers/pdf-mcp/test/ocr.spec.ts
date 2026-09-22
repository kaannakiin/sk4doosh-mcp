import { beforeAll, describe, expect, inject, it } from "vitest";
import {
  createDocumentRoot,
  type DocumentRoot,
} from "../src/platform/paths.js";
import type {
  OcrBinding,
  OcrProvider,
  PageRasterizer,
  RenderedPage,
} from "../src/ocr/port.js";
import { createHandlers } from "../src/tools/handlers.js";
import type { ToolHandlers } from "../src/tools/definitions.js";
import { bodyOf, codeOf } from "./fixtures/harness.js";

let root: DocumentRoot;

beforeAll(async () => {
  root = await createDocumentRoot(inject("fixtures").root);
});

interface Recorder {
  readonly rendered: number[][];
  readonly recognized: number[][];
}

function fakeBinding(
  transcribe: (page: number) => string,
  recorder: Recorder,
  overrides: Partial<OcrBinding> = {},
): OcrBinding {
  const rasterizer: PageRasterizer = {
    render: (job) => {
      recorder.rendered.push([...job.pages]);
      return Promise.resolve(
        job.pages.map((page): RenderedPage => ({
          page,
          image: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
          mediaType: "image/png",
        })),
      );
    },
  };
  const provider: OcrProvider = {
    name: "fake-vision",
    recognize: (job) => {
      recorder.recognized.push(job.pages.map((page) => page.page));
      return Promise.resolve(
        job.pages.map((page) => ({
          page: page.page,
          markdown: transcribe(page.page),
          confidence: 0.91,
        })),
      );
    },
  };
  return { rasterizer, provider, ...overrides };
}

function recorder(): Recorder {
  return { rendered: [], recognized: [] };
}

function handlersWith(binding?: OcrBinding): ToolHandlers {
  return createHandlers(root, binding === undefined ? {} : { ocr: binding });
}

describe("without a provider", () => {
  it("reports ocr as unavailable in capabilities", async () => {
    const body = bodyOf(
      await handlersWith().describe_document({ filePath: "mixed.pdf" }),
    );
    const capabilities = body["capabilities"] as Record<string, boolean>;
    expect(capabilities["ocr"]).toBe(false);
    expect(body["ocrProvider"]).toBeUndefined();
  });

  /**
   * The failure this guards: a caller that asked for OCR being handed the
   * untranscribed pages and reading "no matches" as an answer.
   */
  it("refuses ocr rather than silently skipping it", async () => {
    expect(
      await codeOf(() =>
        handlersWith().read_pages({ filePath: "mixed.pdf", ocr: true }),
      ),
    ).toBe("ocr_unavailable");
    expect(
      await codeOf(() =>
        handlersWith().find_in_document({
          filePath: "mixed.pdf",
          query: "x",
          ocr: true,
        }),
      ),
    ).toBe("ocr_unavailable");
  });
});

describe("with a provider bound", () => {
  it("announces the provider in describe_document", async () => {
    const body = bodyOf(
      await handlersWith(
        fakeBinding(() => "text", recorder()),
      ).describe_document({ filePath: "mixed.pdf" }),
    );
    expect((body["capabilities"] as Record<string, boolean>)["ocr"]).toBe(true);
    expect(body["ocrProvider"]).toBe("fake-vision");
  });

  it("leaves pages alone until ocr is asked for", async () => {
    const seen = recorder();
    const body = bodyOf(
      await handlersWith(fakeBinding(() => "transcribed", seen)).read_pages({
        filePath: "mixed.pdf",
      }),
    );
    const pages = body["pages"] as { page: number; needsOcr: boolean }[];
    expect(pages[1]?.needsOcr).toBe(true);
    expect(seen.rendered).toStrictEqual([]);
    expect(seen.recognized).toStrictEqual([]);
  });

  it("transcribes only the pages the text layer could not answer", async () => {
    const seen = recorder();
    const body = bodyOf(
      await handlersWith(
        fakeBinding((page) => `OCR of page ${String(page)}`, seen),
      ).read_pages({ filePath: "mixed.pdf", ocr: true }),
    );
    expect(seen.rendered).toStrictEqual([[2]]);
    expect(seen.recognized).toStrictEqual([[2]]);
    const pages = body["pages"] as {
      page: number;
      markdown: string;
      needsOcr: boolean;
      source: string;
      ocrConfidence?: number;
    }[];
    expect(pages[0]?.source).toBe("text");
    expect(pages[1]).toMatchObject({
      page: 2,
      markdown: "OCR of page 2",
      needsOcr: false,
      source: "ocr",
      ocrConfidence: 0.91,
    });
    expect(pages[2]?.source).toBe("text");
    expect(body["pagesNeedingOcr"]).toStrictEqual([]);
  });

  it("reports which pages the provider answered", async () => {
    const body = bodyOf(
      await handlersWith(fakeBinding(() => "done", recorder())).read_pages({
        filePath: "mixed.pdf",
        ocr: true,
      }),
    );
    expect(body["ocr"]).toMatchObject({
      provider: "fake-vision",
      recognizedPages: [2],
      truncated: false,
    });
  });

  it("caches a transcription instead of paying for it twice", async () => {
    const seen = recorder();
    const handlers = handlersWith(fakeBinding(() => "once", seen));
    await handlers.read_pages({ filePath: "mixed.pdf", ocr: true });
    await handlers.read_pages({ filePath: "mixed.pdf", ocr: true });
    expect(seen.recognized).toStrictEqual([[2]]);
  });
});

describe("search coverage after OCR", () => {
  it("finds text that only exists on a transcribed page", async () => {
    const handlers = handlersWith(
      fakeBinding(() => "The hidden token is GAMMA", recorder()),
    );
    const before = bodyOf(
      await handlers.find_in_document({
        filePath: "mixed.pdf",
        query: "GAMMA",
      }),
    );
    expect(before["matches"]).toStrictEqual([]);
    expect(before["coverageComplete"]).toBe(false);

    const after = bodyOf(
      await handlers.find_in_document({
        filePath: "mixed.pdf",
        query: "GAMMA",
        ocr: true,
      }),
    );
    const matches = after["matches"] as { page: number }[];
    expect(matches[0]?.page).toBe(2);
    expect(after["unsearchablePages"]).toBe(0);
    expect(after["coverageComplete"]).toBe(true);
  });
});

describe("provider failures stay honest", () => {
  it("keeps the page unreadable when the provider returns nothing", async () => {
    const body = bodyOf(
      await handlersWith(fakeBinding(() => "   ", recorder())).read_pages({
        filePath: "mixed.pdf",
        ocr: true,
      }),
    );
    const pages = body["pages"] as { page: number; needsOcr: boolean }[];
    expect(pages[1]?.needsOcr).toBe(true);
    expect(body["pagesNeedingOcr"]).toStrictEqual([2]);
  });

  it("reports a thrown provider as ocr_failed, not as an empty page", async () => {
    const binding = fakeBinding(() => "unused", recorder());
    const failing: OcrBinding = {
      ...binding,
      provider: {
        name: "broken",
        recognize: () => Promise.reject(new Error("model is offline")),
      },
    };
    expect(
      await codeOf(() =>
        handlersWith(failing).read_pages({ filePath: "mixed.pdf", ocr: true }),
      ),
    ).toBe("ocr_failed");
  });

  /**
   * A port may answer in any order, skip a page, or invent one. Only pages that
   * were asked for may be replaced.
   */
  it("ignores a page the provider was never asked about", async () => {
    const binding = fakeBinding(() => "unused", recorder());
    const liar: OcrBinding = {
      ...binding,
      provider: {
        name: "liar",
        recognize: () =>
          Promise.resolve([
            { page: 1, markdown: "OVERWRITTEN" },
            { page: 2, markdown: "legitimate" },
          ]),
      },
    };
    const body = bodyOf(
      await handlersWith(liar).read_pages({ filePath: "mixed.pdf", ocr: true }),
    );
    const pages = body["pages"] as { markdown: string; source: string }[];
    expect(pages[0]?.markdown).toContain("ALPHA");
    expect(pages[0]?.source).toBe("text");
    expect(pages[1]?.markdown).toBe("legitimate");
  });

  it("caps how many pages one call may transcribe", async () => {
    const seen = recorder();
    const binding = fakeBinding(() => "page text", seen, {
      maxPagesPerCall: 1,
    });
    const body = bodyOf(
      await handlersWith(binding).read_pages({
        filePath: "scanned.pdf",
        ocr: true,
      }),
    );
    expect(seen.recognized).toStrictEqual([[1]]);
    expect(body["ocr"]).toMatchObject({ truncated: false });
  });
});
