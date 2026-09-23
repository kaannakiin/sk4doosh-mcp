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
    SKMCP_LLM_BASE_URL: process.env["SKMCP_LLM_BASE_URL"],
    SKMCP_LLM_MODEL: process.env["SKMCP_LLM_MODEL"],
    SKMCP_LLM_NUM_CTX: process.env["SKMCP_LLM_NUM_CTX"],
  },
  process.cwd(),
);
const live = process.env["SKMCP_LLM_LIVE"] === "1" && outcome.kind === "config";

describe.skipIf(!live)("a real Ollama host", () => {
  const backend = () => {
    if (outcome.kind !== "config") {
      throw new Error("SKMCP_LLM_MODEL is required for the live suite");
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
});
