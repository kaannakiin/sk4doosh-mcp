import type { ChatMessage, QueuedBackend } from "../backend/port.js";
import { fail } from "../platform/errors.js";
import {
  chunkChars,
  estimateTokens,
  inputBudgetTokens,
  limits,
  maxReadableBytes,
  outputBudgetTokens,
} from "../platform/limits.js";
import type { Workspace } from "../platform/workspace.js";
import { chunkText } from "./chunk.js";
import type { ToolInput } from "./definitions.js";
import {
  isSplittable,
  mergePrompt,
  notesPrompt,
  schemaSuffix,
  systemPrompts,
} from "./prompts.js";

export type TaskInput = ToolInput<"local_task">;

export interface TaskSection {
  readonly label: string;
  readonly content: string;
}

export interface ComposedTask {
  readonly messages: readonly ChatMessage[];
  readonly estimatedTokens: number;
}

export type TaskOutcome =
  | { readonly kind: TaskInput["kind"]; readonly answer: string }
  | { readonly kind: TaskInput["kind"]; readonly result: unknown };

export interface TaskUsage {
  readonly chunks: number;
  readonly reduceRounds: number;
  readonly promptTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

export interface TaskDeps {
  readonly backend: QueuedBackend;
  readonly workspace: Workspace;
}

const promptOverheadTokens = 50;
const minNoteTokens = 128;

/**
 * Guard: notes are capped in the model's tokens but measured in estimated ones,
 * and the estimate runs up to twice the real count on English text. Giving all
 * notes together only half of what the final call has left is what makes each
 * merge round shrink them below the budget; capping each note at budget/count
 * was measured never converging on a 54 KB document.
 */
const noteShare = 0.5;
const minChunkChars = 500;

function bodyOf(input: TaskInput, sections: readonly TaskSection[]): string {
  return [
    ...(input.text === undefined || input.text === "" ? [] : [input.text]),
    ...sections.map(({ label, content }) => `--- ${label} ---\n${content}`),
  ].join("\n\n");
}

function systemFor(input: TaskInput): string {
  return input.jsonSchema === undefined
    ? systemPrompts[input.kind]
    : `${systemPrompts[input.kind]}${schemaSuffix}`;
}

export function composeTask(
  input: TaskInput,
  sections: readonly TaskSection[],
): ComposedTask {
  const system = systemFor(input);
  const body = bodyOf(input, sections);
  const user =
    body === "" ? input.instruction : `${input.instruction}\n\n${body}`;
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    estimatedTokens: estimateTokens(system) + estimateTokens(user),
  };
}

function hasInput(input: TaskInput): boolean {
  return (input.text ?? "") !== "" || (input.files ?? []).length > 0;
}

function tooLarge(estimated: number, budget: number): Error {
  return fail(
    "input_too_large",
    `The input is about ${String(estimated)} tokens; one local call takes at most ${String(budget)}.`,
    "summarize and extract split long input themselves; for other kinds split the input and call once per part, or do the work yourself.",
  );
}

function notesSection(notes: readonly string[]): string {
  return notes
    .map((note, index) => `Part ${String(index + 1)}:\n${note}`)
    .join("\n\n");
}

/**
 * Runs one bounded language task on the local model.
 *
 * Guard: every path is resolved before any is read, and the whole prompt is
 * measured before the queue is entered, because the host drops the head of an
 * oversized prompt without an error. An input over the budget is never sent
 * whole: summarize and extract split it and read every part — the measured
 * gain of the local model is on long text, not on tabular data — and every
 * other kind refuses it with the numbers.
 */
export async function runTask(
  { backend, workspace }: TaskDeps,
  input: TaskInput,
  signal?: AbortSignal,
): Promise<TaskOutcome & TaskUsage> {
  if (input.kind !== "free" && !hasInput(input)) {
    throw fail(
      "invalid_argument",
      `A ${input.kind} task needs text or files to work on.`,
      "Pass the input in text, or its paths in files.",
    );
  }
  const started = performance.now();
  const requested = input.files ?? [];
  const paths = await Promise.all(
    requested.map((path) => workspace.resolve(path)),
  );
  const maxBytes = isSplittable(input.kind)
    ? limits.maxLongInputBytes
    : maxReadableBytes(backend.contextTokens);
  const contents = await Promise.all(
    paths.map((path) => workspace.readText(path, maxBytes)),
  );
  const sections = requested.map((label, index) => ({
    label,
    content: contents[index] ?? "",
  }));

  const budget = inputBudgetTokens(backend.contextTokens);
  const tally = { calls: 0, promptTokens: 0, outputTokens: 0 };
  const ask = async (
    system: string,
    user: string,
    maxOutputTokens: number,
    schema?: Readonly<Record<string, unknown>>,
  ): Promise<string> => {
    signal?.throwIfAborted();
    const completion = await backend.complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(schema === undefined ? {} : { schema }),
      maxOutputTokens,
      ...(signal === undefined ? {} : { signal }),
    });
    tally.calls += 1;
    tally.promptTokens += completion.promptTokens;
    tally.outputTokens += completion.outputTokens;
    return completion.text;
  };

  const outputBudget = outputBudgetTokens(backend.contextTokens);
  const task = composeTask(input, sections);
  let text: string;
  let chunks = 1;
  let reduceRounds = 0;
  if (task.estimatedTokens <= budget) {
    const [system, user] = task.messages;
    text = await ask(
      system?.content ?? "",
      user?.content ?? "",
      outputBudget,
      input.jsonSchema,
    );
  } else if (!isSplittable(input.kind)) {
    throw tooLarge(task.estimatedTokens, budget);
  } else {
    const long = await runLong(input, bodyOf(input, sections), {
      budget,
      contextTokens: backend.contextTokens,
      outputBudget,
      ask,
    });
    text = long.text;
    chunks = long.chunks;
    reduceRounds = long.reduceRounds;
  }

  const usage: TaskUsage = {
    chunks,
    reduceRounds,
    promptTokens: tally.promptTokens,
    outputTokens: tally.outputTokens,
    durationMs: Math.round(performance.now() - started),
  };
  if (input.jsonSchema === undefined) {
    return { kind: input.kind, answer: text, ...usage };
  }
  try {
    return {
      kind: input.kind,
      result: JSON.parse(text) as unknown,
      ...usage,
    };
  } catch {
    throw fail(
      "unparsable_output",
      "The local model's answer was not valid JSON for the given schema.",
      "Retry once with a simpler schema, or do the work yourself.",
    );
  }
}

interface LongContext {
  readonly budget: number;
  readonly contextTokens: number;
  readonly outputBudget: number;
  readonly ask: (
    system: string,
    user: string,
    maxOutputTokens: number,
    schema?: Readonly<Record<string, unknown>>,
  ) => Promise<string>;
}

async function runLong(
  input: TaskInput,
  body: string,
  { budget, contextTokens, outputBudget, ask }: LongContext,
): Promise<{
  readonly text: string;
  readonly chunks: number;
  readonly reduceRounds: number;
}> {
  const partial = input.jsonSchema !== undefined;
  const mapSystem = (index: number, total: number): string =>
    `${partial ? systemFor(input) : notesPrompt} This is part ${String(index + 1)} of ${String(total)} of a longer input.`;
  const overhead =
    estimateTokens(mapSystem(limits.maxChunks, limits.maxChunks)) +
    estimateTokens(input.instruction) +
    promptOverheadTokens;
  const mergeOverhead =
    estimateTokens(mergePrompt) +
    estimateTokens(input.instruction) +
    promptOverheadTokens;
  const maxChars = chunkChars(contextTokens, overhead);
  if (maxChars < minChunkChars) {
    throw tooLarge(overhead, budget);
  }
  const parts = chunkText(body, maxChars);
  if (parts.length > limits.maxChunks) {
    throw fail(
      "input_too_large",
      `The input needs ${String(parts.length)} parts; one call reads at most ${String(limits.maxChunks)}.`,
      "Split the input across several calls, or do the work yourself.",
    );
  }

  const finalSystem = systemFor(input);
  const finalUser = (current: readonly string[]): string =>
    `${input.instruction}\n\nNotes gathered from every part of the input, in order:\n\n${notesSection(current)}`;
  const finalOverhead =
    estimateTokens(finalSystem) +
    estimateTokens(finalUser([])) +
    promptOverheadTokens;
  const noteCap = (count: number): number =>
    Math.min(
      outputBudget,
      Math.max(
        minNoteTokens,
        Math.floor(((budget - finalOverhead) * noteShare) / count),
      ),
    );
  let notes: readonly string[] = [];
  for (const [index, part] of parts.entries()) {
    notes = [
      ...notes,
      await ask(
        mapSystem(index, parts.length),
        `${input.instruction}\n\n${part}`,
        noteCap(parts.length),
        input.jsonSchema,
      ),
    ];
  }

  let rounds = 0;
  while (
    estimateTokens(finalSystem) + estimateTokens(finalUser(notes)) >
    budget
  ) {
    if (rounds >= limits.maxReduceRounds) {
      throw tooLarge(estimateTokens(finalUser(notes)), budget);
    }
    rounds += 1;
    const groups = chunkText(
      notesSection(notes),
      chunkChars(contextTokens, mergeOverhead),
    );
    const merged: string[] = [];
    for (const group of groups) {
      merged.push(
        await ask(
          mergePrompt,
          `${input.instruction}\n\nNotes to merge:\n\n${group}`,
          noteCap(groups.length),
        ),
      );
    }
    notes = merged;
  }

  const text = await ask(
    finalSystem,
    finalUser(notes),
    outputBudget,
    input.jsonSchema,
  );
  return { text, chunks: parts.length, reduceRounds: rounds + 1 };
}
