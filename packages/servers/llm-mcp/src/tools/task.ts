import type { ChatMessage, QueuedBackend } from "../backend/port.js";
import { fail } from "../platform/errors.js";
import {
  estimateTokens,
  inputBudgetTokens,
  maxReadableBytes,
  outputBudgetTokens,
} from "../platform/limits.js";
import type { Workspace } from "../platform/workspace.js";
import type { ToolInput } from "./definitions.js";
import { schemaSuffix, systemPrompts } from "./prompts.js";

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

export interface TaskDeps {
  readonly backend: QueuedBackend;
  readonly workspace: Workspace;
}

export function composeTask(
  input: TaskInput,
  sections: readonly TaskSection[],
): ComposedTask {
  const system =
    input.jsonSchema === undefined
      ? systemPrompts[input.kind]
      : `${systemPrompts[input.kind]}${schemaSuffix}`;
  const user = [
    input.instruction,
    ...(input.text === undefined || input.text === "" ? [] : [input.text]),
    ...sections.map(({ label, content }) => `--- ${label} ---\n${content}`),
  ].join("\n\n");
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

/**
 * Runs one bounded language task on the local model.
 *
 * Guard: every path is resolved before any is read, and the whole prompt is
 * measured before the queue is entered. An input over the budget is refused
 * with the numbers, never sent: the host would drop its head without an error.
 */
export async function runTask(
  { backend, workspace }: TaskDeps,
  input: TaskInput,
  signal?: AbortSignal,
): Promise<
  TaskOutcome & {
    readonly promptTokens: number;
    readonly outputTokens: number;
    readonly durationMs: number;
  }
> {
  if (input.kind !== "free" && !hasInput(input)) {
    throw fail(
      "invalid_argument",
      `A ${input.kind} task needs text or files to work on.`,
      "Pass the input in text, or its paths in files.",
    );
  }
  const requested = input.files ?? [];
  const paths = await Promise.all(
    requested.map((path) => workspace.resolve(path)),
  );
  const maxBytes = maxReadableBytes(backend.contextTokens);
  const contents = await Promise.all(
    paths.map((path) => workspace.readText(path, maxBytes)),
  );
  const task = composeTask(
    input,
    requested.map((label, index) => ({
      label,
      content: contents[index] ?? "",
    })),
  );
  const budget = inputBudgetTokens(backend.contextTokens);
  if (task.estimatedTokens > budget) {
    throw fail(
      "input_too_large",
      `The input is about ${String(task.estimatedTokens)} tokens; one local call takes at most ${String(budget)}.`,
      "Split the input and call local_task once per part, or do the work yourself.",
    );
  }
  const completion = await backend.complete({
    messages: task.messages,
    ...(input.jsonSchema === undefined ? {} : { schema: input.jsonSchema }),
    maxOutputTokens: outputBudgetTokens(backend.contextTokens),
    ...(signal === undefined ? {} : { signal }),
  });
  const usage = {
    promptTokens: completion.promptTokens,
    outputTokens: completion.outputTokens,
    durationMs: completion.durationMs,
  };
  if (input.jsonSchema === undefined) {
    return { kind: input.kind, answer: completion.text, ...usage };
  }
  try {
    return {
      kind: input.kind,
      result: JSON.parse(completion.text) as unknown,
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
