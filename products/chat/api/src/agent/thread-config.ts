import type { JsonValue } from "../codex/protocol/generated/serde_json/JsonValue.ts";
import { GATEWAY_SERVER } from "../gateway/gateway-server.service.ts";

const MAX_AGENT_THREADS = 4;

const MAX_AGENT_DEPTH = 1;

const WORKER_TIMEOUT_SEC = 900;

/**
 * Guard: the call timeout stays past the approval hold by a margin. Codex fails
 * a call at this timeout without cancelling it, so the gateway's own hold has to
 * be the one that ends first — see `ApprovalHolds`.
 */
const HOLD_MARGIN_SEC = 60;

export interface ThreadConfigInput {
  readonly gatewayUrl: string;
  readonly grant: string;
  readonly approvalHoldMs: number;
}

/**
 * The per-thread `config` every agent thread is opened with.
 *
 * Guard: the gateway is the thread's only MCP server. Every reader, the local
 * worker and every connected server are reached through it, so each call
 * passes this product's approval gate and invocation rules; a server bound here
 * directly would be spawned by codex and called without either. Measured on
 * 0.154: a sub-agent inherits this entry and calls the gateway with the same
 * grant, while a `dynamicTools` definition never reached one.
 *
 * Guard: codex is told to approve every gateway tool, because the consent
 * decision is the gateway's. Under `auto` codex derives approval from the
 * tool's annotations, and with `approvalPolicy: "never"` it refused both
 * unannotated tools outright ("MCP tool call requires approval, but approval
 * policy is never", measured on 0.154); marking `call_tool` read-only to get past
 * that would be false for `local_map` and for every writing remote tool.
 */
export function threadConfigFor(input: ThreadConfigInput): {
  [key: string]: JsonValue;
} {
  return {
    sandbox_workspace_write: { network_access: false },
    agents: { max_threads: MAX_AGENT_THREADS, max_depth: MAX_AGENT_DEPTH },
    mcp_servers: {
      [GATEWAY_SERVER]: {
        url: input.gatewayUrl,
        http_headers: { Authorization: `Bearer ${input.grant}` },
        default_tools_approval_mode: "approve",
        tool_timeout_sec: Math.max(
          WORKER_TIMEOUT_SEC,
          Math.ceil(input.approvalHoldMs / 1000) + HOLD_MARGIN_SEC,
        ),
      },
    },
  };
}
