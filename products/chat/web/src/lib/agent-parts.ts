import {
  AGENT_APPROVAL_PART,
  agentApprovalSchema,
  type AgentApproval,
} from "@chat/contracts/agent/approval";
import {
  AGENT_STEP_PART,
  AGENT_TELEMETRY_PART,
  agentStepSchema,
  agentTelemetrySchema,
  type AgentStep,
  type AgentTelemetry,
} from "@chat/contracts/agent/stream-parts";
import type { UIMessage } from "ai";

export interface StepEntry {
  readonly id: string;
  readonly step: AgentStep;
}

export interface TurnTelemetry {
  readonly messageId: string;
  readonly telemetry: AgentTelemetry;
  readonly steps: readonly StepEntry[];
}

const STEP_TYPE = `data-${AGENT_STEP_PART}`;

const TELEMETRY_TYPE = `data-${AGENT_TELEMETRY_PART}`;

const APPROVAL_TYPE = `data-${AGENT_APPROVAL_PART}`;

export function agentApprovalOf(
  part: UIMessage["parts"][number],
): AgentApproval | undefined {
  if (part.type !== APPROVAL_TYPE || !("data" in part)) {
    return undefined;
  }
  const parsed = agentApprovalSchema.safeParse(part.data);

  return parsed.success ? parsed.data : undefined;
}

export function agentStepsOf(message: UIMessage): StepEntry[] {
  return message.parts.flatMap((part, index) => {
    if (part.type !== STEP_TYPE || !("data" in part)) {
      return [];
    }
    const parsed = agentStepSchema.safeParse(part.data);
    const id =
      "id" in part && typeof part.id === "string" ? part.id : String(index);

    return parsed.success ? [{ id, step: parsed.data }] : [];
  });
}

export function agentTelemetryOf(
  message: UIMessage,
): AgentTelemetry | undefined {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (part?.type === TELEMETRY_TYPE && "data" in part) {
      const parsed = agentTelemetrySchema.safeParse(part.data);

      return parsed.success ? parsed.data : undefined;
    }
  }

  return undefined;
}

export function turnsOf(messages: readonly UIMessage[]): TurnTelemetry[] {
  return messages.flatMap((message): TurnTelemetry[] => {
    const telemetry =
      message.role === "assistant" ? agentTelemetryOf(message) : undefined;

    return telemetry === undefined
      ? []
      : [{ messageId: message.id, telemetry, steps: agentStepsOf(message) }];
  });
}

export function durationOf(telemetry: AgentTelemetry): number | undefined {
  return telemetry.endedAt === null
    ? undefined
    : telemetry.endedAt - telemetry.startedAt;
}
