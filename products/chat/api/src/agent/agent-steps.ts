import {
  AGENT_STEP_INPUT_MAX_CHARS,
  AGENT_STEP_OUTPUT_MAX_CHARS,
  AGENT_STEP_TEXT_MAX_CHARS,
  type AgentStep,
  type AgentStepStatus,
} from "@chat/contracts/agent/stream-parts";

import type { PatchChangeKind } from "../codex/protocol/generated/v2/PatchChangeKind.ts";
import type { SubAgentActivityKind } from "../codex/protocol/generated/v2/SubAgentActivityKind.ts";
import type { ThreadItem } from "../codex/protocol/generated/v2/ThreadItem.ts";
import { GATEWAY_SERVER } from "../gateway/gateway-server.service.ts";
import type { GatewayCall, WorkerUsage } from "../gateway/gateway-turn.ts";

export type ItemPhase = "started" | "completed";

export type GatewayCalls = ReadonlyMap<string, GatewayCall>;

type ToolCallItem = Extract<ThreadItem, { type: "mcpToolCall" }>;

function resultTextOf(item: ToolCallItem): string | undefined {
  const block = item.result?.content[0];
  const text =
    typeof block === "object" && block !== null && !Array.isArray(block)
      ? block["text"]
      : undefined;

  return typeof text === "string" ? text : undefined;
}

/**
 * Guard: an MCP server's answer is read from its text block, not
 * `structuredContent`. The servers here answer through `json()`, which puts the
 * JSON in `content[0].text` — measured on 0.154, `structuredContent` arrived
 * `null`, and a refusal arrived with `error: null` and `isError: true`, its
 * reason only in that text.
 */
function resultBodyOf(item: ToolCallItem): Record<string, unknown> | undefined {
  const text = resultTextOf(item);
  if (text === undefined) {
    return undefined;
  }

  try {
    const body: unknown = JSON.parse(text);

    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function bounded(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * What the called tool was given. A gateway call carries the tool's own
 * arguments inside its `arguments`, and those are what the reader wants to see
 * rather than the envelope around them.
 */
function inputOf(item: ToolCallItem): string | null {
  const args = objectOf(item.arguments);
  const own =
    item.server === GATEWAY_SERVER && item.tool === "call_tool"
      ? args?.["arguments"]
      : item.arguments;

  return own === undefined || own === null
    ? null
    : bounded(JSON.stringify(own), AGENT_STEP_INPUT_MAX_CHARS);
}

/**
 * What the called tool answered.
 *
 * Guard: a `find_tools` answer is shown as the names it found. It carries every
 * match's full input schema, several kilobytes per turn that say nothing to a
 * reader and would crowd the other steps out of the stored message.
 */
function outputOf(item: ToolCallItem): string | null {
  const text = resultTextOf(item);
  if (text === undefined) {
    return null;
  }

  if (item.server === GATEWAY_SERVER && item.tool === "find_tools") {
    const found = resultBodyOf(item)?.["found"];
    if (Array.isArray(found)) {
      return bounded(
        found
          .map((entry) => objectOf(entry))
          .map(
            (entry) =>
              `${String(entry?.["server"])}.${String(entry?.["name"])}`,
          )
          .join("\n"),
        AGENT_STEP_OUTPUT_MAX_CHARS,
      );
    }
  }

  return bounded(text, AGENT_STEP_OUTPUT_MAX_CHARS);
}

/**
 * The tool a gateway call reached, as the gateway recorded it.
 *
 * Guard: codex sees one server and two tools, so its item names
 * `gateway/call_tool` for every call; what was actually called is the
 * gateway's record, keyed by the item id — measured on 0.154, the id codex
 * gives an `mcpToolCall` item is the `_meta.callId` it sends the server. Before
 * the record exists (the item has only started) the name the agent asked for
 * stands in for it.
 */
export function reachedOf(
  item: ToolCallItem,
  calls: GatewayCalls,
): { server: string; tool: string; workerUsage: WorkerUsage | null } {
  if (item.server !== GATEWAY_SERVER || item.tool !== "call_tool") {
    return { server: item.server, tool: item.tool, workerUsage: null };
  }

  const record = calls.get(item.id);
  if (record !== undefined) {
    return record;
  }

  const args = item.arguments;
  const asked =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? args["name"]
      : undefined;

  return {
    server: GATEWAY_SERVER,
    tool: typeof asked === "string" ? asked : item.tool,
    workerUsage: null,
  };
}

function toolErrorOf(item: ToolCallItem): string | null {
  if (item.error !== null) {
    return item.error.message;
  }
  if (item.status !== "failed") {
    return null;
  }

  const message = resultBodyOf(item)?.["message"];

  return typeof message === "string" ? message : (resultTextOf(item) ?? null);
}

function clamp(value: string): string {
  const single = value.replace(/\s+/gu, " ").trim();

  return single.length > AGENT_STEP_TEXT_MAX_CHARS
    ? `${single.slice(0, AGENT_STEP_TEXT_MAX_CHARS - 1)}…`
    : single;
}

function errorText(message: string | null): string | null {
  return message === null ? null : clamp(message);
}

function statusOf(status: string): AgentStepStatus {
  switch (status) {
    case "inProgress":
      return "running";
    case "completed":
      return "completed";
    default:
      return "failed";
  }
}

function durationOf(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.round(value));
}

function subAgentStatusOf(kind: SubAgentActivityKind): AgentStepStatus {
  switch (kind) {
    case "completed":
      return "completed";
    case "interrupted":
      return "failed";
    default:
      return "running";
  }
}

function changeOf(kind: PatchChangeKind): "add" | "delete" | "update" {
  return kind.type;
}

export function stepOf(
  item: ThreadItem,
  threadId: string,
  phase: ItemPhase,
  calls: GatewayCalls,
): AgentStep | undefined {
  switch (item.type) {
    case "commandExecution":
      return {
        kind: "command",
        threadId,
        status: statusOf(item.status),
        durationMs: durationOf(item.durationMs),
        command: clamp(item.command),
        exitCode: item.exitCode,
      };
    case "fileChange":
      return {
        kind: "file_change",
        threadId,
        status: statusOf(item.status),
        durationMs: null,
        changes: item.changes.map((change) => ({
          path: change.path,
          change: changeOf(change.kind),
        })),
      };
    case "mcpToolCall": {
      const reached = reachedOf(item, calls);

      return {
        kind: "tool_call",
        threadId,
        status: statusOf(item.status),
        durationMs: durationOf(item.durationMs),
        server: reached.server,
        tool: reached.tool,
        error: errorText(toolErrorOf(item)),
        input: inputOf(item),
        output: phase === "completed" ? outputOf(item) : null,
        workerUsage: reached.workerUsage,
      };
    }
    case "subAgentActivity":
      return {
        kind: "subagent",
        threadId,
        status: subAgentStatusOf(item.kind),
        durationMs: null,
        agentThreadId: item.agentThreadId,
        path: item.agentPath,
      };
    case "contextCompaction":
      return {
        kind: "compaction",
        threadId,
        status: phase === "started" ? "running" : "completed",
        durationMs: null,
      };
    default:
      return undefined;
  }
}
