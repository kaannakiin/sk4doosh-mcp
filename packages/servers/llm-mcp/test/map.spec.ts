import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CompletionRequest, QueuedBackend } from "../src/backend/port.js";
import { fail, SkMcpLlmError } from "../src/platform/errors.js";
import { limits } from "../src/platform/limits.js";
import { openWorkspace, type Workspace } from "../src/platform/workspace.js";
import { planBatches, runMap, type MapInput } from "../src/tools/map.js";

type Labeller = (row: number, line: string) => string | undefined;

interface Recorder {
  readonly backend: QueuedBackend;
  readonly requests: CompletionRequest[];
}

function labellingBackend(
  labeller: Labeller,
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
        const lines = (request.messages[1]?.content ?? "")
          .split("\n")
          .filter((line) => /^\d+\|/u.test(line));
        const labels = lines.flatMap((line) => {
          const row = Number(line.slice(0, line.indexOf("|")));
          const label = labeller(row, line);
          return label === undefined ? [] : [{ row, label }];
        });
        return Promise.resolve({
          text: JSON.stringify({ labels }),
          promptTokens: 10,
          outputTokens: 2,
          durationMs: 1,
        });
      },
      probe: () => Promise.resolve({ reachable: true, loaded: true }),
      warm: () => Promise.resolve(),
    },
  };
}

const byWord: Labeller = (_row, line) =>
  line.includes("aldık") ? "BUY" : "SELL";

let base: string;
let workspace: Workspace;

const csv = [
  "id,aciklama,tutar",
  '1,"Anadolu Un\'dan 10 çuval aldık, fatura #1",100',
  "2,Bayiye sevkiyat,200",
  '3,"Çok satırlı\naçıklama, aldık",300',
  "4,Mağazaya satış,400",
].join("\n");

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "llm-mcp-map-")));
  await writeFile(join(base, "islemler.csv"), `${csv}\n`);
  await writeFile(join(base, "labelled.csv"), "id,label\n1,x\n");
  await writeFile(
    join(base, "many.csv"),
    [
      "id",
      ...Array.from({ length: limits.maxMapRows + 1 }, (_, i) => String(i)),
    ].join("\n"),
  );
  workspace = await openWorkspace(base, fail);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const input = (overrides: Partial<MapInput> = {}): MapInput => ({
  file: "islemler.csv",
  instruction: "BUY when we bought, SELL when we sold.",
  labels: ["BUY", "SELL"],
  ...overrides,
});

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  const error: unknown = await work.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(SkMcpLlmError);
  return (error as SkMcpLlmError).code;
};

describe("planBatches", () => {
  it("keeps rows in order and closes a batch at the input budget", () => {
    expect(planBatches([30, 30, 30, 30], 20, 100, 1_000)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("closes a batch when the answer would outgrow its budget", () => {
    const outputBudget = limits.outputTokensPerRow * 2;
    expect(planBatches([1, 1, 1], 0, 1_000, outputBudget)).toEqual([
      [0, 1],
      [2],
    ]);
  });
});

describe("runMap", () => {
  it("writes a labelled copy under the output directory and keeps raw rows", async () => {
    const { backend } = labellingBackend(byWord);
    const outcome = await runMap({ backend, workspace }, input());
    expect(outcome.output).toMatch(
      /^\.llm-mcp\/out\/islemler-label-[a-z0-9]+\.csv$/u,
    );
    expect(outcome).toMatchObject({
      rows: 4,
      counts: { BUY: 2, SELL: 2 },
      unlabeled: 0,
      retriedRows: 0,
    });
    const written = await readFile(join(base, outcome.output), "utf8");
    expect(written).toBe(
      [
        "id,aciklama,tutar,label",
        '1,"Anadolu Un\'dan 10 çuval aldık, fatura #1",100,BUY',
        "2,Bayiye sevkiyat,200,SELL",
        '3,"Çok satırlı\naçıklama, aldık",300,BUY',
        "4,Mağazaya satış,400,SELL",
      ].join("\n") + "\n",
    );
  });

  it("returns up to four sample rows per label", async () => {
    const { backend } = labellingBackend(byWord);
    const outcome = await runMap({ backend, workspace }, input());
    expect(outcome.sample["BUY"]).toHaveLength(2);
    expect(outcome.sample["SELL"]).toEqual([
      "2,Bayiye sevkiyat,200",
      "4,Mağazaya satış,400",
    ]);
  });

  it("asks a skipped row once more, then leaves it unlabelled", async () => {
    let asked = 0;
    const { backend, requests } = labellingBackend((row, line) => {
      if (row === 2) {
        asked += 1;
        return undefined;
      }
      return byWord(row, line);
    });
    const outcome = await runMap({ backend, workspace }, input());
    expect(asked).toBe(2);
    expect(requests).toHaveLength(2);
    expect(outcome).toMatchObject({ retriedRows: 1, unlabeled: 1 });
    const written = await readFile(join(base, outcome.output), "utf8");
    expect(written.split("\n")[2]).toBe("2,Bayiye sevkiyat,200,");
  });

  it("ignores a label outside the allowed set", async () => {
    const { backend } = labellingBackend(() => "MAYBE");
    const outcome = await runMap({ backend, workspace }, input());
    expect(outcome.unlabeled).toBe(4);
  });

  it("adds a new file on every call and leaves the earlier one untouched", async () => {
    const { backend } = labellingBackend(byWord);
    const first = await runMap({ backend, workspace }, input());
    const before = await readFile(join(base, first.output), "utf8");
    const second = await runMap({ backend, workspace }, input());
    expect(second.output).not.toBe(first.output);
    expect(await readFile(join(base, first.output), "utf8")).toBe(before);
  });

  it("sends the row numbers, the allowed labels and an id-bearing schema", async () => {
    const { backend, requests } = labellingBackend(byWord);
    await runMap({ backend, workspace }, input());
    const request = requests[0];
    expect(request?.messages[0]?.content).toContain(
      "Allowed labels: BUY, SELL",
    );
    expect(request?.messages[1]?.content).toContain("row|id,aciklama,tutar");
    expect(request?.messages[1]?.content).toContain("2|2,Bayiye sevkiyat,200");
    expect(request?.messages[1]?.content).toContain(
      '3|3,"Çok satırlı açıklama, aldık",300',
    );
    expect(JSON.stringify(request?.schema)).toContain('"enum":["BUY","SELL"]');
  });

  it("refuses repeated labels, an existing label column and too many rows", async () => {
    const { backend, requests } = labellingBackend(byWord);
    expect(
      await codeOf(
        runMap({ backend, workspace }, input({ labels: ["BUY", "BUY"] })),
      ),
    ).toBe("invalid_argument");
    expect(
      await codeOf(
        runMap({ backend, workspace }, input({ file: "labelled.csv" })),
      ),
    ).toBe("invalid_argument");
    expect(
      await codeOf(runMap({ backend, workspace }, input({ file: "many.csv" }))),
    ).toBe("input_too_large");
    expect(requests).toHaveLength(0);
  });

  it("writes nothing when the call is refused", async () => {
    const before = await readdir(join(base, ".llm-mcp", "out")).catch(() => []);
    const { backend } = labellingBackend(byWord);
    await runMap({ backend, workspace }, input({ labels: ["A", "A"] })).catch(
      () => undefined,
    );
    const after = await readdir(join(base, ".llm-mcp", "out")).catch(() => []);
    expect(after).toEqual(before);
  });
});
