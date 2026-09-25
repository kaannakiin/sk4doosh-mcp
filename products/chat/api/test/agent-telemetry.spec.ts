import { describe, expect, it } from "vitest";

import {
  reachedOf,
  stepOf,
  type GatewayCalls,
} from "../src/agent/agent-steps.ts";
import { TelemetryCollector } from "../src/agent/telemetry-collector.ts";
import type { AppServerNotification } from "../src/codex/app-server/protocol.ts";
import type { ThreadItem } from "../src/codex/protocol/generated/v2/ThreadItem.ts";
import type { GatewayCall } from "../src/gateway/gateway-turn.ts";

const MAIN = "thread-main";
const CHILD = "thread-child";
const STRANGER = "thread-other-conversation";

function asItem(value: object): ThreadItem {
  return value as ThreadItem;
}

const NO_CALLS: GatewayCalls = new Map();

function collector(calls: GatewayCalls = NO_CALLS): TelemetryCollector {
  return new TelemetryCollector({
    mainThreadId: MAIN,
    model: "gpt-6-astra",
    effort: "low",
    workerModel: "qwen3.8:latest",
    startedAt: 1_000,
    calls,
  });
}

function recorded(call: GatewayCall): GatewayCalls {
  return new Map([["call", call]]);
}

function breakdown(total: number) {
  return {
    totalTokens: total,
    inputTokens: total - 10,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 10,
    reasoningOutputTokens: 0,
  };
}

function usage(threadId: string, total: number, last: number) {
  return {
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      turnId: "turn",
      tokenUsage: {
        total: breakdown(total),
        last: breakdown(last),
        modelContextWindow: 258_400,
      },
    },
  } as AppServerNotification;
}

function item(
  method: "item/started" | "item/completed",
  threadId: string,
  value: object,
) {
  return {
    method,
    params: { threadId, turnId: "turn", item: value, startedAtMs: 0 },
  } as AppServerNotification;
}

const spawned = {
  type: "subAgentActivity",
  id: "activity",
  kind: "started",
  agentThreadId: CHILD,
  agentPath: "/root/compute",
};

describe("TelemetryCollector", () => {
  it("reports the last request as context use", () => {
    const telemetry = collector();
    telemetry.apply(usage(MAIN, 56_974, 14_389), 2_000);
    telemetry.apply(
      item("item/completed", MAIN, { type: "contextCompaction", id: "c" }),
      2_100,
    );
    telemetry.apply(usage(MAIN, 56_974, 5_803), 2_200);

    const [main] = telemetry.snapshot().threads;
    expect(main).toMatchObject({
      contextTokens: 5_803,
      contextWindow: 258_400,
      compactions: 1,
    });
  });

  it("counts only this turn's tokens on a resumed thread", () => {
    const telemetry = collector();
    telemetry.apply(usage(MAIN, 213_955, 20_000), 2_000);
    telemetry.apply(usage(MAIN, 448_705, 30_000), 3_000);

    const [main] = telemetry.snapshot().threads;
    expect(main?.usage.total).toBe(254_750);
  });

  it("follows a sub-agent only after its parent announced it", () => {
    const telemetry = collector();
    expect(telemetry.apply(usage(CHILD, 100, 100), 1_500)).toBe(false);

    telemetry.apply(item("item/started", MAIN, spawned), 2_000);
    telemetry.apply(usage(CHILD, 13_887, 13_887), 2_500);
    telemetry.apply(
      item("item/completed", MAIN, { ...spawned, kind: "completed" }),
      3_000,
    );

    const child = telemetry
      .snapshot()
      .threads.find((t) => t.threadId === CHILD);
    expect(child).toMatchObject({
      parentThreadId: MAIN,
      path: "/root/compute",
      status: "completed",
      usage: { total: 13_887 },
      startedAt: 2_000,
      endedAt: 3_000,
    });
  });

  it("ignores another conversation's threads", () => {
    const telemetry = collector();
    expect(telemetry.apply(usage(STRANGER, 500, 500), 2_000)).toBe(false);
    expect(telemetry.snapshot().threads).toHaveLength(1);
  });

  it("adds up the local worker's tokens from the gateway's record", () => {
    const telemetry = collector(
      recorded({
        server: "local",
        tool: "local_task",
        workerUsage: { input: 77, output: 4 },
        queuedMs: 0,
      }),
    );
    telemetry.apply(
      item("item/completed", MAIN, {
        type: "mcpToolCall",
        id: "call",
        server: "gateway",
        tool: "call_tool",
        arguments: { name: "local_task", arguments: {} },
        status: "completed",
        durationMs: 10_160,
        error: null,
        result: { content: [], structuredContent: null, _meta: null },
      }),
      2_000,
    );

    expect(telemetry.snapshot().worker).toEqual({
      calls: 1,
      input: 77,
      output: 4,
      durationMs: 10_160,
    });
  });
});

describe("stepOf", () => {
  it("keeps only the fields the page shows for a command", () => {
    const step = stepOf(
      asItem({
        type: "commandExecution",
        id: "cmd",
        command: "python   report.py\n--weekly",
        status: "completed",
        exitCode: 0,
        durationMs: 812.6,
      }),
      MAIN,
      "completed",
      NO_CALLS,
    );

    expect(step).toEqual({
      kind: "command",
      threadId: MAIN,
      status: "completed",
      durationMs: 813,
      command: "python report.py --weekly",
      exitCode: 0,
    });
  });

  it("is not a step for a message", () => {
    expect(
      stepOf(
        asItem({ type: "agentMessage", id: "m", text: "hi" }),
        MAIN,
        "completed",
        NO_CALLS,
      ),
    ).toBeUndefined();
  });
});

describe("stepOf for a refused tool call", () => {
  it("reads the reason from the answer's text", () => {
    const step = stepOf(
      asItem({
        type: "mcpToolCall",
        id: "call",
        server: "gateway",
        tool: "call_tool",
        arguments: { name: "local_task", arguments: {} },
        status: "failed",
        durationMs: 2,
        error: null,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "not_text",
                message: "'files/basket.xlsx' is not UTF-8 text.",
              }),
            },
          ],
          structuredContent: null,
          _meta: null,
        },
      }),
      MAIN,
      "completed",
      recorded({
        server: "local",
        tool: "local_task",
        workerUsage: null,
        queuedMs: 0,
      }),
    );

    expect(step).toMatchObject({
      kind: "tool_call",
      server: "local",
      tool: "local_task",
      status: "failed",
      error: "'files/basket.xlsx' is not UTF-8 text.",
    });
  });
});

describe("reachedOf", () => {
  it("names the tool the agent asked for until the gateway recorded it", () => {
    expect(
      reachedOf(
        asItem({
          type: "mcpToolCall",
          id: "call",
          server: "gateway",
          tool: "call_tool",
          arguments: { name: "read_sheet", arguments: {} },
        }) as Extract<ThreadItem, { type: "mcpToolCall" }>,
        NO_CALLS,
      ),
    ).toEqual({ server: "gateway", tool: "read_sheet", workerUsage: null });
  });

  it("leaves a call to any other server as codex named it", () => {
    expect(
      reachedOf(
        asItem({
          type: "mcpToolCall",
          id: "call",
          server: "gateway",
          tool: "find_tools",
          arguments: { query: "sheet" },
        }) as Extract<ThreadItem, { type: "mcpToolCall" }>,
        recorded({
          server: "workbook",
          tool: "read_sheet",
          workerUsage: null,
          queuedMs: null,
        }),
      ),
    ).toEqual({ server: "gateway", tool: "find_tools", workerUsage: null });
  });
});
