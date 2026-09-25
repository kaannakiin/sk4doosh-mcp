import type { AgentApproval } from "@chat/contracts/agent/approval";
import type {
  AgentStep,
  AgentTelemetry,
} from "@chat/contracts/agent/stream-parts";
import type { UIMessage, UIMessageStreamWriter } from "ai";

export interface AgentDataParts {
  "agent-step": AgentStep;
  "agent-telemetry": AgentTelemetry;
  "agent-approval": AgentApproval;
  [key: string]: unknown;
}

export type AgentUIMessage = UIMessage<unknown, AgentDataParts>;

export type AgentStreamWriter = UIMessageStreamWriter<AgentUIMessage>;
