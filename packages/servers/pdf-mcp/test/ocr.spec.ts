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
import { pdfWithPages } from "./fixtures/pdf.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

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

describe("search while OCR is still catching up", () => {
  /**
   * The failure this guards: OCR transcribes a bounded batch per call, so a page
   * can become readable only after the cursor has already walked past it. Every
   * match on that page is then lost, and the walk still reports complete
   * coverage.
   */
  it("never walks past a page whose text has not arrived yet", async () => {
    const root = inject("fixtures").root;
    const name = "slow-ocr.pdf";
    await writeFile(
      join(root, name),
      pdfWithPages([
        ...Array.from({ length: 11 }, () => ({ kind: "image" }) as const),
        { kind: "text", lines: ["ZETA marker one", "ZETA marker two"] },
      ]),
    );

    const seen = recorder();
    const handlers = handlersWith(
      fakeBinding(
        (page) =>
          page === 11 ? "ZETA hidden on eleven" : `page ${String(page)}`,
        seen,
      ),
    );

    const pages: number[] = [];
    let cursor: string | undefined;
    let last: Record<string, unknown> = {};
    for (let round = 0; round < 10; round += 1) {
      last = bodyOf(
        await handlers.find_in_document({
          filePath: name,
          query: "ZETA",
          ocr: true,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      for (const match of last["matches"] as { page: number }[]) {
        pages.push(match.page);
      }
      const next = last["nextCursor"];
      if (next === undefined) break;
      cursor = String(next);
    }

    expect(pages).toStrictEqual([11, 12, 12]);
    expect(last["coverageComplete"]).toBe(true);
  }, 30_000);

  it("refuses a cursor once the caller turns OCR on mid-walk", async () => {
    const handlers = handlersWith(fakeBinding(() => "transcribed", recorder()));
    const first = bodyOf(
      await handlers.find_in_document({
        filePath: "many.pdf",
        query: "MARK",
        maxResults: 5,
      }),
    );
    expect(
      await codeOf(() =>
        handlers.find_in_document({
          filePath: "many.pdf",
          query: "MARK",
          ocr: true,
          cursor: String(first["nextCursor"]),
        }),
      ),
    ).toBe("invalid_argument");
  });
});

describe("a timed-out request does not free the machine", () => {
  /**
   * The failure this guards: the deadline answers the caller while the provider
   * keeps working, so releasing the slot at that moment makes the gate count
   * requests that have not timed out rather than work that is actually running.
   * A host could then be asked to run any number of transcriptions at once.
   */
  it("holds the slot until the provider settles, not until the wait expires", async () => {
    let finish!: () => void;
    const hanging = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const base = fakeBinding(() => "unused", recorder());
    const handlers = handlersWith({
      ...base,
      timeoutMs: 60,
      provider: {
        name: "hanging",
        recognize: async () => {
          await hanging;
          return [];
        },
      },
    });

    expect(
      await codeOf(() =>
        handlers.read_pages({ filePath: "mixed.pdf", ocr: true }),
      ),
    ).toBe("ocr_failed");

    expect(
      await codeOf(() =>
        handlers.read_pages({ filePath: "mixed.pdf", ocr: true }),
      ),
    ).toBe("resource_limit");

    finish();
  }, 20_000);
});

describe("answers are matched to what the provider actually saw", () => {
  /**
   * The failure this guards: validating answers against the pages the rasterizer
   * was *asked* for, rather than the images that actually reached recognize().
   * A page the rasterizer silently omitted never became an image, so a provider
   * answering for it is answering about something it never saw.
   */
  it("discards an answer for a page the rasterizer never rendered", async () => {
    const seen = recorder();
    const binding: OcrBinding = {
      rasterizer: {
        render: (job) => {
          seen.rendered.push([...job.pages]);
          const [first] = job.pages;
          return Promise.resolve(
            first === undefined
              ? []
              : [
                  {
                    page: first,
                    image: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
                    mediaType: "image/png" as const,
                  },
                ],
          );
        },
      },
      provider: {
        name: "over-eager",
        recognize: (job) => {
          seen.recognized.push(job.pages.map((page) => page.page));
          return Promise.resolve([
            { page: 2, markdown: "legitimate transcript of page two" },
            { page: 4, markdown: "INVENTED for a page never sent" },
          ]);
        },
      },
    };

    const body = bodyOf(
      await handlersWith(binding).read_pages({
        filePath: "alternating.pdf",
        ocr: true,
      }),
    );
    const pages = body["pages"] as {
      page: number;
      needsOcr: boolean;
      markdown: string;
    }[];
    expect(seen.recognized).toStrictEqual([[2]]);
    for (const page of pages) {
      expect(page.markdown).not.toContain("INVENTED");
    }
    expect(pages.find((page) => page.page === 2)?.markdown).toBe(
      "legitimate transcript of page two",
    );
    expect(pages.find((page) => page.page === 4)?.needsOcr).toBe(true);
  });
});
