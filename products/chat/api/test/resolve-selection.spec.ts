import type {
  AgentSelection,
  CodexModel,
  WorkerModel,
} from "@chat/contracts/agent/model";
import { describe, expect, it } from "vitest";

import { resolveSelection } from "../src/agent/resolve-selection.ts";

function codex(id: string, efforts: string[], isDefault = false): CodexModel {
  return {
    id,
    displayName: id,
    description: "",
    efforts: efforts.map((effort) => ({ effort, description: "" })),
    defaultEffort: "medium",
    isDefault,
    multiAgent: true,
  };
}

function worker(id: string): WorkerModel {
  return {
    id,
    hostId: "main",
    parameterSize: null,
    contextLength: 131_072,
    loaded: false,
  };
}

const NONE: AgentSelection = {
  codexModel: null,
  effort: null,
  workerModel: null,
};

const CODEX = [
  codex("astra", ["low", "medium", "high"], true),
  codex("luna", ["low", "medium"]),
];

const WORKERS = [worker("qwen"), worker("oss")];

const DEFAULTS = {
  codexModel: undefined,
  effort: undefined,
  workerModel: "qwen",
};

describe("resolveSelection", () => {
  it("falls back to the catalog default and the deployment worker", () => {
    expect(
      resolveSelection({
        codexModels: CODEX,
        workerModels: WORKERS,
        user: NONE,
        session: null,
        defaults: DEFAULTS,
      }),
    ).toEqual({ codexModel: "astra", effort: "medium", workerModel: "qwen" });
  });

  it("ranks the conversation above the reader's default", () => {
    expect(
      resolveSelection({
        codexModels: CODEX,
        workerModels: WORKERS,
        user: { codexModel: "astra", effort: "high", workerModel: "qwen" },
        session: { codexModel: "luna", effort: "low", workerModel: "oss" },
        defaults: DEFAULTS,
      }),
    ).toEqual({ codexModel: "luna", effort: "low", workerModel: "oss" });
  });

  it("drops a model the catalog no longer offers", () => {
    expect(
      resolveSelection({
        codexModels: CODEX,
        workerModels: WORKERS,
        user: { codexModel: "retired", effort: null, workerModel: "gone" },
        session: null,
        defaults: DEFAULTS,
      }),
    ).toEqual({ codexModel: "astra", effort: "medium", workerModel: "qwen" });
  });

  it("replaces an effort the chosen model does not support", () => {
    expect(
      resolveSelection({
        codexModels: CODEX,
        workerModels: WORKERS,
        user: NONE,
        session: { codexModel: "luna", effort: "high", workerModel: null },
        defaults: DEFAULTS,
      }),
    ).toEqual({ codexModel: "luna", effort: "medium", workerModel: "qwen" });
  });

  it("keeps the choice when a catalog could not be read", () => {
    expect(
      resolveSelection({
        codexModels: [],
        workerModels: [],
        user: { codexModel: "luna", effort: "high", workerModel: "oss" },
        session: null,
        defaults: DEFAULTS,
      }),
    ).toEqual({ codexModel: "luna", effort: "high", workerModel: "oss" });
  });
});
