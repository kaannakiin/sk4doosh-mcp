import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaBackend } from "../src/backend/ollama.js";
import { LiaisoLlmError } from "../src/platform/errors.js";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown> | undefined;
}

function stubFetch(
  reply: (call: Call) => Response | Promise<Response>,
): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const call: Call = {
      url: String(url),
      method: init.method ?? "GET",
      body:
        init.body === undefined
          ? undefined
          : (JSON.parse(String(init.body)) as Record<string, unknown>),
    };
    calls.push(call);
    return Promise.resolve(reply(call));
  });
  return calls;
}

const answer = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const backend = () =>
  createOllamaBackend({
    baseUrl: "http://ollama.test:11434",
    model: "qwen3:8b",
    contextTokens: 16_384,
    keepAlive: "30m",
    timeoutMs: 5_000,
  });

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  const error: unknown = await work.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(LiaisoLlmError);
  return (error as LiaisoLlmError).code;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("complete", () => {
  it("sends the measured request shape to /api/chat", async () => {
    const calls = stubFetch(() =>
      answer({
        message: { content: "ok" },
        prompt_eval_count: 12,
        eval_count: 3,
      }),
    );
    const schema = { type: "object" };
    await backend().complete({
      messages: [{ role: "user", content: "hi" }],
      schema,
      maxOutputTokens: 64,
    });
    expect(calls[0]?.url).toBe("http://ollama.test:11434/api/chat");
    expect(calls[0]?.body).toEqual({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      think: false,
      keep_alive: "30m",
      format: schema,
      options: { temperature: 0, num_ctx: 16_384, num_predict: 64 },
    });
  });

  it("leaves format and num_predict out when not asked for", async () => {
    const calls = stubFetch(() => answer({ message: { content: "ok" } }));
    await backend().complete({ messages: [{ role: "user", content: "hi" }] });
    expect(calls[0]?.body).not.toHaveProperty("format");
    expect(calls[0]?.body?.["options"]).toEqual({
      temperature: 0,
      num_ctx: 16_384,
    });
  });

  it("returns the text and the host's token counts", async () => {
    stubFetch(() =>
      answer({
        message: { content: "ok" },
        prompt_eval_count: 12,
        eval_count: 3,
      }),
    );
    const result = await backend().complete({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result).toMatchObject({
      text: "ok",
      promptTokens: 12,
      outputTokens: 3,
    });
  });

  it("reports an error field on a 200 as a refusal, not as the answer", async () => {
    stubFetch(() => answer({ error: "model 'qwen3:8b' not found" }));
    expect(
      await codeOf(
        backend().complete({ messages: [{ role: "user", content: "hi" }] }),
      ),
    ).toBe("backend_refused");
  });

  it("reports a non-2xx status as a refusal", async () => {
    stubFetch(() => new Response("nope", { status: 500 }));
    expect(
      await codeOf(
        backend().complete({ messages: [{ role: "user", content: "hi" }] }),
      ),
    ).toBe("backend_refused");
  });

  it("reports a host that does not answer as unavailable", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    expect(
      await codeOf(
        backend().complete({ messages: [{ role: "user", content: "hi" }] }),
      ),
    ).toBe("backend_unavailable");
  });

  it("reports a body without message content as a refusal", async () => {
    stubFetch(() => answer({ done: true }));
    expect(
      await codeOf(
        backend().complete({ messages: [{ role: "user", content: "hi" }] }),
      ),
    ).toBe("backend_refused");
  });
});

describe("probe", () => {
  it("sees the model among the loaded ones", async () => {
    const calls = stubFetch(() => answer({ models: [{ name: "qwen3:8b" }] }));
    expect(await backend().probe()).toEqual({ reachable: true, loaded: true });
    expect(calls[0]).toMatchObject({
      url: "http://ollama.test:11434/api/ps",
      method: "GET",
    });
  });

  it("reports a reachable host without the model loaded", async () => {
    stubFetch(() => answer({ models: [{ name: "bge-m3:latest" }] }));
    expect(await backend().probe()).toEqual({ reachable: true, loaded: false });
  });

  it("turns an unreachable host into data instead of a throw", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const probe = await backend().probe();
    expect(probe.reachable).toBe(false);
  });
});

describe("warm", () => {
  it("loads the model with an empty message list and the configured window", async () => {
    const calls = stubFetch(() => answer({ done: true, done_reason: "load" }));
    await backend().warm();
    expect(calls[0]?.body).toMatchObject({
      messages: [],
      keep_alive: "30m",
      options: { num_ctx: 16_384 },
    });
  });
});
