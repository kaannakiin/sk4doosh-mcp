import { truncateWellFormed } from "@sk-mcp/mcp-core";
import type { QueuedBackend } from "../backend/port.js";
import { csvField, fieldsOf, parseTable } from "../platform/csv.js";
import { fail } from "../platform/errors.js";
import {
  estimateTokens,
  inputBudgetTokens,
  limits,
  outputBudgetTokens,
} from "../platform/limits.js";
import type { Workspace } from "../platform/workspace.js";
import type { ToolInput } from "./definitions.js";
import { systemPrompts } from "./prompts.js";

export type MapInput = ToolInput<"local_map">;

export interface MapDeps {
  readonly backend: QueuedBackend;
  readonly workspace: Workspace;
}

export interface MapOutcome {
  readonly output: string;
  readonly rows: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly unlabeled: number;
  readonly sample: Readonly<Record<string, readonly string[]>>;
  readonly batches: number;
  readonly calls: number;
  readonly retriedRows: number;
  readonly promptTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly verify: string;
}

const defaultLabelColumn = "label";
const samplesPerLabel = 4;
const rowOverheadTokens = 1;
const fixedOverheadTokens = 50;
const answerMarginTokens = 200;

const verifyHint =
  "Check the sample rows against your intent before using the output; if they are wrong, sharpen the instruction and run again.";

/**
 * Groups rows into batches that fit both the input budget and the answer
 * budget, in order.
 *
 * @param rowTokens the estimated tokens of each numbered row
 * @param fixedTokens the tokens every batch spends before its first row
 * @returns row indices per batch
 */
export function planBatches(
  rowTokens: readonly number[],
  fixedTokens: number,
  inputBudget: number,
  outputBudget: number,
): readonly (readonly number[])[] {
  const batches: number[][] = [];
  let current: number[] = [];
  let used = fixedTokens;
  rowTokens.forEach((tokens, index) => {
    const answer = (current.length + 1) * limits.outputTokensPerRow;
    if (
      current.length > 0 &&
      (used + tokens > inputBudget || answer > outputBudget)
    ) {
      batches.push(current);
      current = [];
      used = fixedTokens;
    }
    current.push(index);
    used += tokens;
  });
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

function labelSchema(
  labels: readonly string[],
): Readonly<Record<string, unknown>> {
  return {
    type: "object",
    properties: {
      labels: {
        type: "array",
        items: {
          type: "object",
          properties: {
            row: { type: "integer" },
            label: { type: "string", enum: labels },
          },
          required: ["row", "label"],
        },
      },
    },
    required: ["labels"],
  };
}

function answersOf(
  text: string,
  asked: ReadonlySet<number>,
  allowed: ReadonlySet<string>,
): ReadonlyMap<number, string> {
  const found = new Map<number, string>();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return found;
  }
  const entries =
    typeof body === "object" && body !== null && "labels" in body
      ? body.labels
      : undefined;
  if (!Array.isArray(entries)) {
    return found;
  }
  for (const entry of entries as unknown[]) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { row, label } = entry as { row?: unknown; label?: unknown };
    if (
      typeof row === "number" &&
      typeof label === "string" &&
      asked.has(row) &&
      allowed.has(label)
    ) {
      found.set(row, label);
    }
  }
  return found;
}

/**
 * Guard: a quoted field may hold a line break, and a row that spans two lines
 * in the prompt loses its number on the second one. The model sees the row on
 * one line; the output file keeps the raw record.
 */
function oneLine(row: string): string {
  return row.replace(/\r?\n/gu, " ");
}

function stemOf(file: string, labelColumn: string): string {
  const base = file.split(/[\\/]/u).pop() ?? "output";
  const stem = base.replace(/\.[^.]*$/u, "");
  return `${stem}-${labelColumn}-${Date.now().toString(36)}`;
}

function samplesOf(
  rows: readonly string[],
  assigned: readonly (string | undefined)[],
  labels: readonly string[],
): Record<string, readonly string[]> {
  return Object.fromEntries(
    labels.map((label) => {
      const hits = assigned.flatMap((value, index) =>
        value === label ? [index] : [],
      );
      const take = Math.min(samplesPerLabel, hits.length);
      const picked = Array.from({ length: take }, (_, step) => {
        const index = hits[Math.floor((step * hits.length) / take)] ?? 0;
        return truncateWellFormed(rows[index] ?? "", limits.maxStringChars);
      });
      return [label, picked];
    }),
  );
}

/**
 * Labels every row of a CSV file on the local model and adds the labelled
 * copy to the server's output directory.
 *
 * Guard: each row keeps its number through the model and back, because an
 * id-less answer format was measured losing its place. A row the model
 * skipped is asked once more, then left unlabelled and counted, never
 * guessed.
 */
export async function runMap(
  { backend, workspace }: MapDeps,
  input: MapInput,
  signal?: AbortSignal,
): Promise<MapOutcome> {
  const started = performance.now();
  const labels = input.labels;
  const allowed = new Set(labels);
  if (allowed.size !== labels.length) {
    throw fail(
      "invalid_argument",
      "labels must not repeat.",
      "Pass each label once.",
    );
  }
  const labelColumn = input.labelColumn ?? defaultLabelColumn;
  const path = await workspace.resolve(input.file);
  const table = parseTable(await workspace.readText(path, limits.maxMapBytes));
  if (table === undefined || table.rows.length === 0) {
    throw fail(
      "invalid_argument",
      `'${input.file}' has no data rows.`,
      "Pass a CSV file with a header row and at least one data row.",
    );
  }
  const { header, rows, delimiter } = table;
  if (fieldsOf(header, delimiter).some((name) => name.trim() === labelColumn)) {
    throw fail(
      "invalid_argument",
      `'${input.file}' already has a '${labelColumn}' column.`,
      "Pass another labelColumn.",
    );
  }
  if (rows.length > limits.maxMapRows) {
    throw fail(
      "input_too_large",
      `'${input.file}' has ${String(rows.length)} rows; one call labels at most ${String(limits.maxMapRows)}.`,
      "Split the file and call local_map once per part.",
    );
  }

  const system = `${systemPrompts.classify} Allowed labels: ${labels.join(", ")}. Each input line starts with a row number and '|'. Return one entry per row with that row number.`;
  const preamble = `${input.instruction}\n\nrow|${header}`;
  const lineOf = (index: number): string =>
    `${String(index + 1)}|${oneLine(rows[index] ?? "")}`;
  const fixedTokens =
    estimateTokens(system) + estimateTokens(preamble) + fixedOverheadTokens;
  const inputBudget = inputBudgetTokens(backend.contextTokens);
  const rowTokens = rows.map(
    (_, index) => estimateTokens(lineOf(index)) + rowOverheadTokens,
  );
  const oversized = rowTokens.findIndex(
    (tokens) => fixedTokens + tokens > inputBudget,
  );
  if (oversized >= 0) {
    throw fail(
      "input_too_large",
      `Row ${String(oversized + 1)} of '${input.file}' alone exceeds the local budget.`,
      "Shorten that row or label the file yourself.",
    );
  }
  const plan = planBatches(
    rowTokens,
    fixedTokens,
    inputBudget,
    outputBudgetTokens(backend.contextTokens),
  );

  const schema = labelSchema(labels);
  const assigned: (string | undefined)[] = rows.map(() => undefined);
  let calls = 0;
  let retriedRows = 0;
  let promptTokens = 0;
  let outputTokens = 0;

  const ask = async (
    indices: readonly number[],
  ): Promise<ReadonlyMap<number, string>> => {
    signal?.throwIfAborted();
    const completion = await backend.complete({
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [preamble, ...indices.map(lineOf)].join("\n"),
        },
      ],
      schema,
      maxOutputTokens:
        indices.length * limits.outputTokensPerRow * 2 + answerMarginTokens,
      ...(signal === undefined ? {} : { signal }),
    });
    calls += 1;
    promptTokens += completion.promptTokens;
    outputTokens += completion.outputTokens;
    return answersOf(
      completion.text,
      new Set(indices.map((index) => index + 1)),
      allowed,
    );
  };

  for (const batch of plan) {
    const first = await ask(batch);
    const missing = batch.filter((index) => !first.has(index + 1));
    const second =
      missing.length === 0 ? new Map<number, string>() : await ask(missing);
    retriedRows += missing.length;
    for (const index of batch) {
      assigned[index] = first.get(index + 1) ?? second.get(index + 1);
    }
  }

  const output = await workspace.createOutput(
    stemOf(input.file, labelColumn),
    [
      `${header}${delimiter}${csvField(labelColumn, delimiter)}`,
      ...rows.map(
        (row, index) =>
          `${row}${delimiter}${csvField(assigned[index] ?? "", delimiter)}`,
      ),
    ].join("\n") + "\n",
  );

  const counts = Object.fromEntries(
    labels.map((label) => [
      label,
      assigned.filter((value) => value === label).length,
    ]),
  );
  return {
    output,
    rows: rows.length,
    counts,
    unlabeled: assigned.filter((value) => value === undefined).length,
    sample: samplesOf(rows, assigned, labels),
    batches: plan.length,
    calls,
    retriedRows,
    promptTokens,
    outputTokens,
    durationMs: Math.round(performance.now() - started),
    verify: verifyHint,
  };
}
