import type {
  AgentTelemetry,
  AgentThreadTelemetry,
  TokenUsage,
} from "@chat/contracts/agent/stream-parts";

import type { StepEntry, TurnTelemetry } from "./agent-parts";

export interface TokenSplit {
  readonly fresh: number;
  readonly cached: number;
  readonly output: number;
  readonly processed: number;
}

export interface TurnPoint {
  readonly messageId: string;
  readonly index: number;
  readonly tokens: TokenSplit;
  readonly contextTokens: number | null;
  readonly contextWindow: number | null;
  readonly compactions: number;
  readonly durationMs: number | null;
}

export interface SessionSummary {
  readonly telemetry: AgentTelemetry;
  readonly steps: readonly StepEntry[];
  readonly points: readonly TurnPoint[];
  readonly tokens: TokenSplit;
  readonly durationMs: number;
}

const NO_TOKENS: TokenSplit = { fresh: 0, cached: 0, output: 0, processed: 0 };

/**
 * Guard: `fresh` is the uncached input plus the output, and it is the number a
 * reader is shown first. Codex resends the whole context on every request of a
 * turn and most of it is served from the prompt cache — measured on a two
 * question conversation, 383 k of 449 k processed tokens were cached — so the
 * processed total reads as ten times the work that was actually new.
 */
export function splitOf(usage: TokenUsage): TokenSplit {
  return {
    fresh: Math.max(0, usage.input - usage.cachedInput) + usage.output,
    cached: usage.cachedInput,
    output: usage.output,
    processed: usage.total,
  };
}

function add(left: TokenSplit, right: TokenSplit): TokenSplit {
  return {
    fresh: left.fresh + right.fresh,
    cached: left.cached + right.cached,
    output: left.output + right.output,
    processed: left.processed + right.processed,
  };
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    input: left.input + right.input,
    cachedInput: left.cachedInput + right.cachedInput,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    output: left.output + right.output,
    reasoning: left.reasoning + right.reasoning,
    total: left.total + right.total,
  };
}

export function turnTokens(telemetry: AgentTelemetry): TokenSplit {
  return telemetry.threads.reduce(
    (sum, thread) => add(sum, splitOf(thread.usage)),
    NO_TOKENS,
  );
}

function durationOf(
  entry: Pick<AgentThreadTelemetry, "startedAt" | "endedAt">,
): number {
  return entry.endedAt === null ? 0 : entry.endedAt - entry.startedAt;
}

function mergeThread(
  merged: AgentThreadTelemetry | undefined,
  thread: AgentThreadTelemetry,
): AgentThreadTelemetry {
  if (merged === undefined) {
    return { ...thread, startedAt: 0, endedAt: durationOf(thread) };
  }

  return {
    ...merged,
    model: thread.model ?? merged.model,
    status: thread.status,
    usage: addUsage(merged.usage, thread.usage),
    contextTokens: thread.contextTokens ?? merged.contextTokens,
    contextWindow: thread.contextWindow ?? merged.contextWindow,
    compactions: merged.compactions + thread.compactions,
    endedAt: (merged.endedAt ?? 0) + durationOf(thread),
  };
}

export function summarizeSession(
  turns: readonly TurnTelemetry[],
): SessionSummary | undefined {
  const last = turns.at(-1);
  if (last === undefined) {
    return undefined;
  }

  const threads = new Map<string, AgentThreadTelemetry>();
  const worker = { calls: 0, input: 0, output: 0, durationMs: 0 };
  let durationMs = 0;
  const points = turns.map((turn, index): TurnPoint => {
    const { telemetry } = turn;
    for (const thread of telemetry.threads) {
      threads.set(
        thread.threadId,
        mergeThread(threads.get(thread.threadId), thread),
      );
    }
    worker.calls += telemetry.worker.calls;
    worker.input += telemetry.worker.input;
    worker.output += telemetry.worker.output;
    worker.durationMs += telemetry.worker.durationMs;
    const turnDuration =
      telemetry.endedAt === null
        ? null
        : telemetry.endedAt - telemetry.startedAt;
    durationMs += turnDuration ?? 0;
    const main = telemetry.threads.find(
      (thread) => thread.parentThreadId === null,
    );

    return {
      messageId: turn.messageId,
      index: index + 1,
      tokens: turnTokens(telemetry),
      contextTokens: main?.contextTokens ?? null,
      contextWindow: main?.contextWindow ?? null,
      compactions: main?.compactions ?? 0,
      durationMs: turnDuration,
    };
  });

  const rateLimit =
    [...turns].reverse().find((turn) => turn.telemetry.rateLimit !== null)
      ?.telemetry.rateLimit ?? null;

  return {
    telemetry: {
      ...last.telemetry,
      threads: [...threads.values()],
      worker,
      rateLimit,
      startedAt: 0,
      endedAt: durationMs,
    },
    steps: turns.flatMap((turn) => turn.steps),
    points,
    tokens: points.reduce((sum, point) => add(sum, point.tokens), NO_TOKENS),
    durationMs,
  };
}
