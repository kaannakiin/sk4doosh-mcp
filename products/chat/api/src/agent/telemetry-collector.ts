import type {
  AgentTelemetry,
  AgentThreadTelemetry,
  RateLimit,
  TokenUsage,
  WorkerTelemetry,
} from "@chat/contracts/agent/stream-parts";

import type { AppServerNotification } from "../codex/app-server/protocol.ts";
import { reachedOf, type GatewayCalls } from "./agent-steps.ts";
import type { TokenUsageBreakdown } from "../codex/protocol/generated/v2/TokenUsageBreakdown.ts";
import type { TurnStatus } from "../codex/protocol/generated/v2/TurnStatus.ts";

export interface TelemetryStart {
  readonly mainThreadId: string;
  readonly model: string | null;
  readonly effort: string | null;
  readonly workerModel: string | null;
  readonly startedAt: number;
  readonly calls: GatewayCalls;
}

const EMPTY_USAGE: TokenUsage = {
  input: 0,
  cachedInput: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  total: 0,
};

function usageOf(breakdown: TokenUsageBreakdown): TokenUsage {
  return {
    input: breakdown.inputTokens,
    cachedInput: breakdown.cachedInputTokens,
    cacheWrite: breakdown.cacheWriteInputTokens,
    output: breakdown.outputTokens,
    reasoning: breakdown.reasoningOutputTokens,
    total: breakdown.totalTokens,
  };
}

function minus(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    input: Math.max(0, left.input - right.input),
    cachedInput: Math.max(0, left.cachedInput - right.cachedInput),
    cacheWrite: Math.max(0, left.cacheWrite - right.cacheWrite),
    output: Math.max(0, left.output - right.output),
    reasoning: Math.max(0, left.reasoning - right.reasoning),
    total: Math.max(0, left.total - right.total),
  };
}

function threadStatusOf(status: TurnStatus): AgentThreadTelemetry["status"] {
  return status === "inProgress" ? "running" : status;
}

/**
 * Folds the app-server's notifications into one turn's agent tree.
 *
 * Guard: `tokenUsage.total` is the thread's running total and `last` is the most
 * recent request, which is what occupies the context window — measured on 0.154:
 * a compaction left `total` unchanged and dropped `last` from 14 389 to 5 803.
 * Reporting `total` as context use would show a window that never empties.
 *
 * Guard: usage is reported per turn, as the distance from a baseline taken at
 * the thread's first update in this turn. `total` is the thread's running total
 * across every turn it has run, so a resumed thread reported it twice: a second
 * question of the same conversation showed 448 705 tokens, 193 955 of them the
 * first question's, and summing turns counted those again. The baseline is
 * `total - last`, the running total before the request that produced this update.
 *
 * Guard: a sub-agent is announced two ways and both are followed. Measured on
 * 0.154: `gpt-6-astra` reported one as `subAgentActivity`, while `gpt-5.6-luna`
 * emitted only a `collabAgentToolCall` of `spawnAgent` naming the new thread in
 * `receiverThreadIds` — tracking the first alone showed a luna turn whose whole
 * work ran in a sub-agent as one idle thread with no tool calls.
 *
 * Guard: a thread is followed only once its parent announced it. Every
 * conversation shares one app-server connection, so a notification for a thread
 * this turn never spawned belongs to another reader's conversation.
 */
export class TelemetryCollector {
  private readonly threads = new Map<string, AgentThreadTelemetry>();

  private rateLimit: RateLimit | null = null;

  private worker: WorkerTelemetry = {
    calls: 0,
    input: 0,
    output: 0,
    durationMs: 0,
  };

  private endedAt: number | null = null;

  private readonly baselines = new Map<string, TokenUsage>();

  constructor(private readonly start: TelemetryStart) {
    this.threads.set(start.mainThreadId, {
      threadId: start.mainThreadId,
      parentThreadId: null,
      path: null,
      model: start.model,
      status: "running",
      usage: EMPTY_USAGE,
      contextTokens: null,
      contextWindow: null,
      compactions: 0,
      startedAt: start.startedAt,
      endedAt: null,
    });
  }

  owns(threadId: string): boolean {
    return this.threads.has(threadId);
  }

  apply(notification: AppServerNotification, now: number): boolean {
    switch (notification.method) {
      case "thread/tokenUsage/updated": {
        const { threadId, tokenUsage } = notification.params;
        if (!this.owns(threadId)) {
          return false;
        }
        const total = usageOf(tokenUsage.total);
        const baseline =
          this.baselines.get(threadId) ??
          minus(total, usageOf(tokenUsage.last));
        this.baselines.set(threadId, baseline);

        return this.update(threadId, {
          usage: minus(total, baseline),
          contextTokens: tokenUsage.last.totalTokens,
          contextWindow: tokenUsage.modelContextWindow,
        });
      }
      case "item/started":
      case "item/completed": {
        const { item, threadId } = notification.params;
        if (!this.owns(threadId)) {
          return false;
        }
        if (item.type === "subAgentActivity") {
          return this.track(threadId, item.agentThreadId, item.agentPath, {
            status: item.kind === "completed" ? "completed" : "running",
            now,
          });
        }
        if (
          item.type === "collabAgentToolCall" &&
          item.tool === "spawnAgent" &&
          item.receiverThreadIds.some((id) => !this.owns(id))
        ) {
          const model = item.model;

          return item.receiverThreadIds
            .filter((id) => !this.owns(id))
            .map(
              (id) =>
                this.track(item.senderThreadId, id, null, {
                  status: "running",
                  now,
                }) &&
                (model === null || this.update(id, { model })),
            )
            .some(Boolean);
        }
        if (
          item.type === "collabAgentToolCall" &&
          notification.method === "item/started" &&
          item.model !== null
        ) {
          const model = item.model;

          return item.receiverThreadIds
            .map((id) => this.update(id, { model }))
            .some(Boolean);
        }
        if (
          notification.method === "item/completed" &&
          item.type === "mcpToolCall"
        ) {
          const usage = reachedOf(item, this.start.calls).workerUsage;
          if (usage !== null) {
            this.worker = {
              calls: this.worker.calls + 1,
              input: this.worker.input + usage.input,
              output: this.worker.output + usage.output,
              durationMs:
                this.worker.durationMs + Math.round(item.durationMs ?? 0),
            };

            return true;
          }
        }
        if (
          item.type === "contextCompaction" &&
          notification.method === "item/completed"
        ) {
          const thread = this.threads.get(threadId);

          return this.update(threadId, {
            compactions: (thread?.compactions ?? 0) + 1,
          });
        }

        return false;
      }
      case "turn/completed": {
        const { threadId, turn } = notification.params;

        return this.update(threadId, {
          status: threadStatusOf(turn.status),
          endedAt: now,
        });
      }
      case "account/rateLimits/updated": {
        const { primary, planType } = notification.params.rateLimits;
        if (primary === null) {
          return false;
        }
        this.rateLimit = {
          usedPercent: primary.usedPercent,
          windowMinutes: primary.windowDurationMins,
          resetsAt: primary.resetsAt,
          plan: planType ?? this.rateLimit?.plan ?? null,
        };

        return true;
      }
      default:
        return false;
    }
  }

  finish(now: number): void {
    this.endedAt = now;
  }

  snapshot(): AgentTelemetry {
    return {
      model: this.start.model,
      effort: this.start.effort,
      workerModel: this.start.workerModel,
      threads: [...this.threads.values()],
      worker: this.worker,
      rateLimit: this.rateLimit,
      startedAt: this.start.startedAt,
      endedAt: this.endedAt,
    };
  }

  private track(
    parentThreadId: string,
    threadId: string,
    path: string | null,
    { status, now }: { status: AgentThreadTelemetry["status"]; now: number },
  ): boolean {
    const existing = this.threads.get(threadId);
    if (existing !== undefined) {
      return this.update(threadId, {
        status,
        endedAt: status === "running" ? null : now,
      });
    }

    this.threads.set(threadId, {
      threadId,
      parentThreadId,
      path,
      model: null,
      status,
      usage: EMPTY_USAGE,
      contextTokens: null,
      contextWindow: null,
      compactions: 0,
      startedAt: now,
      endedAt: null,
    });

    return true;
  }

  private update(
    threadId: string,
    patch: Partial<AgentThreadTelemetry>,
  ): boolean {
    const thread = this.threads.get(threadId);
    if (thread === undefined) {
      return false;
    }

    this.threads.set(threadId, { ...thread, ...patch });

    return true;
  }
}
