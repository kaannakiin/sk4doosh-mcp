import { describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOllamaBackend } from "../src/backend/ollama.js";
import { createSerialBackend } from "../src/backend/serial.js";
import { readLlmEnv } from "../src/platform/env.js";
import { fail } from "../src/platform/errors.js";
import { openWorkspace } from "../src/platform/workspace.js";
import { runTask } from "../src/tools/task.js";

const outcome = readLlmEnv(
  {
    LIAISO_LLM_BASE_URL: process.env["LIAISO_LLM_BASE_URL"],
    LIAISO_LLM_MODEL: process.env["LIAISO_LLM_MODEL"],
    LIAISO_LLM_NUM_CTX: process.env["LIAISO_LLM_NUM_CTX"],
  },
  process.cwd(),
);
const live =
  process.env["LIAISO_LLM_LIVE"] === "1" && outcome.kind === "config";

describe.skipIf(!live)("a real Ollama host", () => {
  const backend = () => {
    if (outcome.kind !== "config") {
      throw new Error("LIAISO_LLM_MODEL is required for the live suite");
    }
    return createOllamaBackend(outcome.config);
  };

  it("loads the model and then sees it loaded", async () => {
    await backend().warm();
    expect(await backend().probe()).toEqual({ reachable: true, loaded: true });
  }, 120_000);

  it("answers a schema-constrained request", async () => {
    const result = await backend().complete({
      messages: [{ role: "user", content: "Reply with the number 7." }],
      schema: {
        type: "object",
        properties: { value: { type: "integer" } },
        required: ["value"],
      },
      maxOutputTokens: 32,
    });
    expect(JSON.parse(result.text)).toEqual({ value: 7 });
    expect(result.promptTokens).toBeGreaterThan(0);
  }, 120_000);

  it("extracts people and dates from a short Turkish text as JSON", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "llm-mcp-live-")));
    try {
      await writeFile(
        join(base, "toplanti.txt"),
        "Toplantıya Ayşe Demir ve Mehmet Kaya katıldı. Bir sonraki görüşme 14 Ekim 2026'da yapılacak.",
      );
      const outcome = await runTask(
        {
          backend: createSerialBackend(backend()),
          workspace: await openWorkspace(base, fail),
        },
        {
          kind: "extract",
          instruction:
            "Extract the attendees' full names and the next meeting date as YYYY-MM-DD.",
          files: ["toplanti.txt"],
          jsonSchema: {
            type: "object",
            properties: {
              people: { type: "array", items: { type: "string" } },
              nextMeeting: { type: "string" },
            },
            required: ["people", "nextMeeting"],
          },
        },
      );
      expect(outcome).toMatchObject({
        result: {
          people: expect.arrayContaining(["Ayşe Demir", "Mehmet Kaya"]),
          nextMeeting: "2026-10-14",
        },
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 120_000);

  it("summarizes a long text past the budget and keeps its last decision", async () => {
    const paragraphs = Array.from(
      { length: 60 },
      (_, index) =>
        `${String(index + 1)}. madde: depo sayımında raf ${String(index + 1)} için eksik ürünler listelendi ve sorumlu ekip bilgilendirildi, ek bir karar alınmadı.`,
    );
    const text = [
      ...paragraphs,
      ...paragraphs,
      "Son karar: yıllık sayım 12 Aralık 2026 tarihine ertelendi.",
    ].join("\n\n");
    const base = await realpath(await mkdtemp(join(tmpdir(), "llm-mcp-long-")));
    try {
      const outcome = await runTask(
        {
          backend: createSerialBackend(backend()),
          workspace: await openWorkspace(base, fail),
        },
        {
          kind: "summarize",
          instruction: "Alınan kararları yaz.",
          text: text.repeat(2),
        },
      );
      expect(outcome.chunks).toBeGreaterThan(1);
      expect("answer" in outcome ? outcome.answer : "").toMatch(/12 Aralık/u);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  }, 600_000);
});
