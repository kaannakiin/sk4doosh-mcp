import { describe, expect, it } from "vitest";
import { readLlmEnv } from "../src/platform/env.js";

const model = { SKMCP_LLM_MODEL: "qwen3:8b" };
const cwd = "/work/space";

describe("readLlmEnv", () => {
  it("names the missing model", () => {
    expect(readLlmEnv({}, cwd)).toEqual({
      kind: "usage",
      missing: ["SKMCP_LLM_MODEL"],
    });
  });

  it("treats an empty model as missing", () => {
    expect(readLlmEnv({ SKMCP_LLM_MODEL: "" }, cwd).kind).toBe("usage");
  });

  it("fills the measured defaults", () => {
    expect(readLlmEnv(model, cwd)).toEqual({
      kind: "config",
      config: {
        root: "/work/space",
        outputDir: ".llm-mcp/out",
        baseUrl: "http://127.0.0.1:11434",
        model: "qwen3:8b",
        contextTokens: 16_384,
        keepAlive: "30m",
        timeoutMs: 300_000,
      },
    });
  });

  it("takes every setting it is given", () => {
    const outcome = readLlmEnv(
      {
        ...model,
        SKMCP_LLM_ROOT: "/elsewhere",
        SKMCP_LLM_OUTPUT_DIR: "out",
        SKMCP_LLM_BASE_URL: "http://10.0.0.5:11434",
        SKMCP_LLM_NUM_CTX: "8192",
        SKMCP_LLM_KEEP_ALIVE: "5m",
        SKMCP_LLM_TIMEOUT_MS: "1000",
      },
      cwd,
    );
    expect(outcome).toEqual({
      kind: "config",
      config: {
        root: "/elsewhere",
        outputDir: "out",
        baseUrl: "http://10.0.0.5:11434",
        model: "qwen3:8b",
        contextTokens: 8192,
        keepAlive: "5m",
        timeoutMs: 1000,
      },
    });
  });

  it.each(["not a url", "file:///etc/passwd", "ftp://host"])(
    "refuses the base url %s",
    (raw) => {
      expect(readLlmEnv({ ...model, SKMCP_LLM_BASE_URL: raw }, cwd).kind).toBe(
        "invalid",
      );
    },
  );

  it.each(["0", "4095", "1.5", "abc", "-1"])(
    "refuses the context window %s",
    (raw) => {
      expect(readLlmEnv({ ...model, SKMCP_LLM_NUM_CTX: raw }, cwd).kind).toBe(
        "invalid",
      );
    },
  );

  it("refuses a timeout that is not a positive integer", () => {
    expect(readLlmEnv({ ...model, SKMCP_LLM_TIMEOUT_MS: "0" }, cwd).kind).toBe(
      "invalid",
    );
  });
});
