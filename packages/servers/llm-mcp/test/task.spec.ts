import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CompletionRequest, QueuedBackend } from "../src/backend/port.js";
import { fail, SkMcpLlmError } from "../src/platform/errors.js";
import {
  estimateTokens,
  inputBudgetTokens,
  limits,
  outputBudgetTokens,
} from "../src/platform/limits.js";
import { openWorkspace, type Workspace } from "../src/platform/workspace.js";
import { schemaSuffix, systemPrompts } from "../src/tools/prompts.js";
import { composeTask, runTask, type TaskInput } from "../src/tools/task.js";

interface Recorder {
  readonly backend: QueuedBackend;
  readonly requests: CompletionRequest[];
}

function recordingBackend(
  reply: string | ((request: CompletionRequest) => string) = "ok",
  contextTokens = 16_384,
): Recorder {
  const requests: CompletionRequest[] = [];
  return {
    requests,
    backend: {
      model: "qwen3:8b",
      contextTokens,
      pending: 0,
      complete: (request) => {
        requests.push(request);
        return Promise.resolve({
          text: typeof reply === "string" ? reply : reply(request),
          promptTokens: 40,
          outputTokens: 5,
          durationMs: 12,
        });
      },
      probe: () => Promise.resolve({ reachable: true, loaded: true }),
      warm: () => Promise.resolve(),
    },
  };
}

let base: string;
let workspace: Workspace;

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "llm-mcp-task-")));
  await writeFile(join(base, "a.txt"), "Ayşe 3 Mart'ta geldi.");
  await writeFile(join(base, "long.txt"), "kelime ".repeat(3_000));
  await writeFile(join(base, "huge.txt"), `${"uzun metin ".repeat(6_000)}`);
  workspace = await openWorkspace(base, fail);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const task = (input: Partial<TaskInput>): TaskInput => ({
  kind: "extract",
  instruction: "List the people.",
  ...input,
});

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  const error: unknown = await work.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(SkMcpLlmError);
  return (error as SkMcpLlmError).code;
};

describe("composeTask", () => {
  it("puts the kind's prompt first and the instruction before the input", () => {
    const { messages } = composeTask(task({ text: "inline" }), [
      { label: "a.txt", content: "body" },
    ]);
    expect(messages).toEqual([
      { role: "system", content: systemPrompts.extract },
      {
        role: "user",
        content: "List the people.\n\ninline\n\n--- a.txt ---\nbody",
      },
    ]);
  });

  it("tells the model to answer in JSON when a schema is given", () => {
    const { messages } = composeTask(
      task({ text: "x", jsonSchema: { type: "object" } }),
      [],
    );
    expect(messages[0]?.content).toBe(
      `${systemPrompts.extract}${schemaSuffix}`,
    );
  });
});

describe("runTask", () => {
  it("reads the files itself and labels them with the requested path", async () => {
    const recorder = recordingBackend();
    const outcome = await runTask(
      { ...recorder, workspace },
      task({ files: ["a.txt"] }),
    );
    expect(recorder.requests[0]?.messages[1]?.content).toContain(
      "--- a.txt ---\nAyşe 3 Mart'ta geldi.",
    );
    expect(outcome).toMatchObject({
      kind: "extract",
      answer: "ok",
      chunks: 1,
      reduceRounds: 0,
      promptTokens: 40,
      outputTokens: 5,
    });
  });

  it("caps the answer at the output budget", async () => {
    const recorder = recordingBackend();
    await runTask({ ...recorder, workspace }, task({ text: "x" }));
    expect(recorder.requests[0]?.maxOutputTokens).toBe(
      outputBudgetTokens(16_384),
    );
  });

  it("passes the schema to the host and parses the answer", async () => {
    const recorder = recordingBackend('{"people":["Ayşe"]}');
    const schema = { type: "object" };
    const outcome = await runTask(
      { ...recorder, workspace },
      task({ text: "x", jsonSchema: schema }),
    );
    expect(recorder.requests[0]?.schema).toBe(schema);
    expect(outcome).toMatchObject({ result: { people: ["Ayşe"] } });
  });

  it("reports an answer that is not JSON", async () => {
    const recorder = recordingBackend("not json");
    expect(
      await codeOf(
        runTask(
          { ...recorder, workspace },
          task({ text: "x", jsonSchema: { type: "object" } }),
        ),
      ),
    ).toBe("unparsable_output");
  });

  it("asks for input unless the kind is free", async () => {
    const recorder = recordingBackend();
    expect(await codeOf(runTask({ ...recorder, workspace }, task({})))).toBe(
      "invalid_argument",
    );
    await runTask({ ...recorder, workspace }, task({ kind: "free" }));
    expect(recorder.requests).toHaveLength(1);
  });

  it("refuses an unsplittable input over the budget without calling the host", async () => {
    const recorder = recordingBackend("ok", 4_096);
    expect(
      await codeOf(
        runTask(
          { ...recorder, workspace },
          task({ kind: "transform", files: ["long.txt"] }),
        ),
      ),
    ).toBe("input_too_large");
    expect(recorder.requests).toHaveLength(0);
  });

  it("reads nothing when one path is outside the workspace", async () => {
    const recorder = recordingBackend();
    expect(
      await codeOf(
        runTask(
          { ...recorder, workspace },
          task({ files: ["a.txt", "../elsewhere.txt"] }),
        ),
      ),
    ).toBe("outside_workspace");
    expect(recorder.requests).toHaveLength(0);
  });
});

const markers = (text: string): readonly string[] =>
  text.match(/P\d\d|SONKARAR/gu) ?? [];

const longText = [
  ...Array.from(
    { length: 40 },
    (_, index) =>
      `P${String(index).padStart(2, "0")} ${"toplantıda konuşulan ayrıntı ".repeat(10)}`,
  ),
  "SONKARAR: oturumlar kullanıcı başına önbelleklenecek.",
].join("\n\n");

const withinBudget = (request: CompletionRequest, contextTokens: number) =>
  estimateTokens(request.messages[0]?.content ?? "") +
    estimateTokens(request.messages[1]?.content ?? "") <=
  inputBudgetTokens(contextTokens);

const isFinal = (request: CompletionRequest): boolean =>
  (request.messages[1]?.content ?? "").includes("Notes gathered");

describe("runTask on long input", () => {
  it("splits a long summarize, reads every part and merges the notes", async () => {
    const recorder = recordingBackend(
      (request) =>
        isFinal(request)
          ? "final summary"
          : `notes ${markers(request.messages[1]?.content ?? "").join(" ")}`,
      4_096,
    );
    const outcome = await runTask(
      { ...recorder, workspace },
      task({ kind: "summarize", instruction: "Özetle.", text: longText }),
    );
    const final = recorder.requests.at(-1);
    expect(outcome).toMatchObject({
      answer: "final summary",
      reduceRounds: 1,
    });
    expect(outcome.chunks).toBeGreaterThan(2);
    expect(recorder.requests).toHaveLength(outcome.chunks + 1);
    expect(
      recorder.requests.every((request) => withinBudget(request, 4_096)),
    ).toBe(true);
    expect(final && isFinal(final)).toBe(true);
    expect(markers(final?.messages[1]?.content ?? "")).toContain("SONKARAR");
    expect(markers(final?.messages[1]?.content ?? "")).toContain("P00");
  });

  it("passes the schema to every part and to the merge in a long extract", async () => {
    const recorder = recordingBackend('{"decisions":["x"]}', 4_096);
    const schema = { type: "object" };
    const outcome = await runTask(
      { ...recorder, workspace },
      task({ text: longText, jsonSchema: schema }),
    );
    expect(outcome).toMatchObject({ result: { decisions: ["x"] } });
    expect(
      recorder.requests.every((request) => request.schema === schema),
    ).toBe(true);
  });

  it("adds merge rounds when the notes outgrow the budget", async () => {
    const recorder = recordingBackend((request) => {
      const system = request.messages[0]?.content ?? "";
      if (isFinal(request)) {
        return "final";
      }
      return system.startsWith("You merge") ? "merged" : "not ".repeat(400);
    }, 4_096);
    const outcome = await runTask(
      { ...recorder, workspace },
      task({ kind: "summarize", instruction: "Özetle.", text: longText }),
    );
    expect(outcome.reduceRounds).toBeGreaterThan(1);
    expect(
      recorder.requests.every((request) => withinBudget(request, 4_096)),
    ).toBe(true);
  });

  it("still refuses a long classify without calling the host", async () => {
    const recorder = recordingBackend("ok", 4_096);
    expect(
      await codeOf(
        runTask(
          { ...recorder, workspace },
          task({ kind: "classify", text: longText }),
        ),
      ),
    ).toBe("input_too_large");
    expect(recorder.requests).toHaveLength(0);
  });

  it("refuses more parts than one call may read, before any call", async () => {
    const recorder = recordingBackend("ok", 4_096);
    const endless = "cümle ".repeat(limits.maxChunks * 700);
    expect(
      await codeOf(
        runTask(
          { ...recorder, workspace },
          task({ kind: "summarize", text: endless }),
        ),
      ),
    ).toBe("input_too_large");
    expect(recorder.requests).toHaveLength(0);
  });

  it("reads a file past the single-call ceiling only for splittable kinds", async () => {
    const summarize = recordingBackend("ok");
    const outcome = await runTask(
      { ...summarize, workspace },
      task({ kind: "summarize", files: ["huge.txt"] }),
    );
    expect(outcome.chunks).toBeGreaterThan(1);
    const transform = recordingBackend("ok");
    expect(
      await codeOf(
        runTask(
          { ...transform, workspace },
          task({ kind: "transform", files: ["huge.txt"] }),
        ),
      ),
    ).toBe("input_too_large");
    expect(transform.requests).toHaveLength(0);
  });
});
