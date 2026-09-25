import {
  AGENT_TELEMETRY_PART_ID,
  type AgentTelemetry,
} from "@chat/contracts/agent/stream-parts";

import type { AppServerNotification } from "../codex/app-server/protocol.ts";
import type { ThreadItem } from "../codex/protocol/generated/v2/ThreadItem.ts";
import type { AgentStreamWriter } from "./agent-message.ts";
import { stepOf, type GatewayCalls, type ItemPhase } from "./agent-steps.ts";

type PartKind = "text" | "reasoning";

interface OpenPart {
  readonly id: string;
  readonly kind: PartKind;
  opened: boolean;
}

export class TurnRenderer {
  private readonly open = new Map<string, OpenPart>();

  constructor(
    private readonly writer: AgentStreamWriter,
    private readonly mainThreadId: string,
    private readonly calls: GatewayCalls,
  ) {}

  render(notification: AppServerNotification): void {
    switch (notification.method) {
      case "item/started":
        this.started(notification.params.item, notification.params.threadId);

        return;
      case "item/agentMessage/delta": {
        const { threadId, itemId, delta } = notification.params;
        if (threadId === this.mainThreadId) {
          this.delta(
            this.open.get(itemId) ?? this.openPart(itemId, "text"),
            delta,
          );
        }

        return;
      }
      case "item/completed":
        this.completed(notification.params.item, notification.params.threadId);

        return;
      default:
        return;
    }
  }

  telemetry(snapshot: AgentTelemetry): void {
    this.writer.write({
      type: "data-agent-telemetry",
      id: AGENT_TELEMETRY_PART_ID,
      data: snapshot,
    });
  }

  closeAll(): void {
    for (const part of this.open.values()) {
      if (part.opened) {
        this.writer.write({ type: `${part.kind}-end`, id: part.id });
      }
    }
    this.open.clear();
  }

  private started(item: ThreadItem, threadId: string): void {
    if (item.type === "agentMessage" && threadId === this.mainThreadId) {
      this.openPart(
        item.id,
        item.phase === "commentary" ? "reasoning" : "text",
      );

      return;
    }

    this.step(item, threadId, "started");
  }

  private completed(item: ThreadItem, threadId: string): void {
    if (threadId === this.mainThreadId && item.type === "agentMessage") {
      const part =
        this.open.get(item.id) ??
        this.openPart(
          item.id,
          item.phase === "commentary" ? "reasoning" : "text",
        );
      if (!part.opened) {
        this.delta(part, item.text);
      }
      this.end(item.id, part);

      return;
    }

    if (threadId === this.mainThreadId && item.type === "reasoning") {
      const text = item.summary.join("\n").trim();
      if (text !== "") {
        const part = this.openPart(item.id, "reasoning");
        this.delta(part, text);
        this.end(item.id, part);
      }

      return;
    }

    this.step(item, threadId, "completed");
  }

  private step(item: ThreadItem, threadId: string, phase: ItemPhase): void {
    const step = stepOf(item, threadId, phase, this.calls);
    if (step !== undefined) {
      this.writer.write({
        type: "data-agent-step",
        id:
          step.kind === "subagent"
            ? `subagent:${step.agentThreadId}`
            : `${threadId}:${item.id}`,
        data: step,
      });
    }
  }

  private openPart(itemId: string, kind: PartKind): OpenPart {
    const part: OpenPart = { id: itemId, kind, opened: false };
    this.open.set(itemId, part);

    return part;
  }

  private delta(part: OpenPart, delta: string): void {
    if (delta === "") {
      return;
    }
    if (!part.opened) {
      this.writer.write({ type: `${part.kind}-start`, id: part.id });
      part.opened = true;
    }
    this.writer.write({ type: `${part.kind}-delta`, id: part.id, delta });
  }

  private end(itemId: string, part: OpenPart): void {
    if (part.opened) {
      this.writer.write({ type: `${part.kind}-end`, id: part.id });
    }
    this.open.delete(itemId);
  }
}
