import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaOcrProvider } from "../src/provider.js";
import type { RenderedPage } from "../src/port.js";

const page = (number: number): RenderedPage => ({
  page: number,
  image: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, number]),
  mediaType: "image/png",
});

interface Call {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

function stubFetch(
  reply: (call: Call) => Response | Promise<Response>,
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const call = {
      url: String(url),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    };
    calls.push(call);
    return Promise.resolve(reply(call));
  });
  return calls;
}

const ok = (response: string): Response =>
  new Response(JSON.stringify({ response }), { status: 200 });

const provider = () =>
  createOllamaOcrProvider({
    baseUrl: "http://ollama.test:11434",
    model: "deepseek-ocr:3b",
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request shape", () => {
  it("posts one page at a time to /api/generate", async () => {
    const calls = stubFetch(() => ok("transcript"));
    const recognized = await provider().recognize({
      pages: [page(1), page(2)],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("http://ollama.test:11434/api/generate");
    expect(recognized.map((entry) => entry.page)).toStrictEqual([1, 2]);
  });

  /**
   * Measured against deepseek-ocr: a bare instruction, and the grounding prompt
   * in particular, mixes bounding boxes into the transcript. "Free OCR." returns
   * the page's text and nothing else.
   */
  it("sends the measured prompt and a deterministic temperature", async () => {
    const calls = stubFetch(() => ok("x"));
    await provider().recognize({ pages: [page(1)] });
    expect(calls[0]?.body["prompt"]).toBe("<image>\nFree OCR.");
    expect(calls[0]?.body["stream"]).toBe(false);
    expect(calls[0]?.body["options"]).toStrictEqual({ temperature: 0 });
  });

  it("base64-encodes the image the rasterizer produced", async () => {
    const calls = stubFetch(() => ok("x"));
    await provider().recognize({ pages: [page(7)] });
    const images = calls[0]?.body["images"] as string[];
    expect(Buffer.from(images[0] ?? "", "base64")).toStrictEqual(
      Buffer.from(page(7).image),
    );
  });

  it("names itself after the model it is bound to", () => {
    expect(provider().name).toBe("ollama/deepseek-ocr:3b");
  });

  it("keeps a base url that already carries a path from swallowing it", () => {
    const named = createOllamaOcrProvider({
      baseUrl: "http://ollama.test:11434",
      model: "m",
      prompt: "custom",
    });
    expect(named.name).toBe("ollama/m");
  });
});

describe("failures", () => {
  it("reports a non-2xx status with the page it belongs to", async () => {
    stubFetch(() => new Response("nope", { status: 503 }));
    await expect(provider().recognize({ pages: [page(4)] })).rejects.toThrow(
      /503 for page 4/,
    );
  });

  it("reports an error field the model returned", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: "model not found" }), {
          status: 200,
        }),
    );
    await expect(provider().recognize({ pages: [page(1)] })).rejects.toThrow(
      /model not found/,
    );
  });

  it("refuses a body with no transcript rather than inventing one", async () => {
    stubFetch(
      () => new Response(JSON.stringify({ done: true }), { status: 200 }),
    );
    await expect(provider().recognize({ pages: [page(1)] })).rejects.toThrow(
      /no transcript/,
    );
  });

  it("names the host when the connection never answers", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")));
    await expect(provider().recognize({ pages: [page(1)] })).rejects.toThrow(
      /ollama\.test:11434/,
    );
  });
});

describe("transcripts", () => {
  it("trims the model's surrounding whitespace", async () => {
    stubFetch(() => ok("\n  SCANNED NOTE\n  line two\n\n"));
    const [recognized] = await provider().recognize({ pages: [page(1)] });
    expect(recognized?.markdown).toBe("SCANNED NOTE\n  line two");
  });

  /**
   * An empty transcript is passed through rather than dropped: pdf-mcp is the
   * layer that decides an empty answer leaves the page marked needsOcr.
   */
  it("passes an empty transcript through untouched", async () => {
    stubFetch(() => ok("   "));
    const [recognized] = await provider().recognize({ pages: [page(1)] });
    expect(recognized?.markdown).toBe("");
  });
});
