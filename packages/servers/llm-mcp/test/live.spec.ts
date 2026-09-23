import { describe, expect, it } from "vitest";
import { createOllamaBackend } from "../src/backend/ollama.js";
import { readLlmEnv } from "../src/platform/env.js";

const outcome = readLlmEnv({
  SKMCP_LLM_BASE_URL: process.env["SKMCP_LLM_BASE_URL"],
  SKMCP_LLM_MODEL: process.env["SKMCP_LLM_MODEL"],
  SKMCP_LLM_NUM_CTX: process.env["SKMCP_LLM_NUM_CTX"],
});
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
});
