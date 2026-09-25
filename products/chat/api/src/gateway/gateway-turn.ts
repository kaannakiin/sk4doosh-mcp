import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";

import type { AgentStreamWriter } from "../agent/agent-message.ts";
import type { TurnApproval } from "../chat/tool-approval-gate.service.ts";
import type { UserId } from "../db/ids.ts";

export interface WorkerUsage {
  readonly input: number;
  readonly output: number;
}

export interface GatewayResult {
  readonly text: string;
  readonly isError: boolean;
  readonly workerUsage: WorkerUsage | null;
  readonly queuedMs: number | null;
}

/**
 * One tool the gateway can reach. `invoke` is bound to the conversation that
 * built the directory, so a call can only ever land on that conversation's
 * servers.
 */
export interface DirectoryEntry {
  readonly name: string;
  readonly server: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly searchable: string;
  readonly consent: "gate" | "none";
  readonly invoke: (
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<GatewayResult>;
}

export type ToolDirectory = ReadonlyMap<string, DirectoryEntry>;

export interface GatewayCall {
  readonly server: string;
  readonly tool: string;
  readonly workerUsage: WorkerUsage | null;
  readonly queuedMs: number | null;
}

/**
 * What a grant resolves to while its turn runs: who is acting, in which
 * conversation, through which tools and under which consent.
 */
export interface GatewayTurn {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly locale: Locale;
  readonly signal: AbortSignal;
  readonly writer: AgentStreamWriter;
  readonly directory: ToolDirectory;
  readonly approval: TurnApproval;
  readonly allowed: Set<string>;
  readonly calls: Map<string, GatewayCall>;
}
