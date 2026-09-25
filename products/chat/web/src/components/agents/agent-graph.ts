import type {
  AgentTelemetry,
  AgentThreadTelemetry,
} from "@chat/contracts/agent/stream-parts";

import type { StepEntry } from "~/lib/agent-parts";
import { splitOf } from "~/lib/agent-session";

export const NODE_WIDTH = 236;

export const NODE_HEIGHT = 118;

const GAP_X = 28;

const GAP_Y = 72;

const WORKER_SERVER = "local";

export type GraphNodeKind = "main" | "subagent" | "worker" | "server";

export type GraphStatus = "running" | "completed" | "failed" | "interrupted";

export interface GraphNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: GraphNodeKind;
  readonly title: string | null;
  readonly model: string | null;
  readonly status: GraphStatus;
  readonly tokens: number | null;
  readonly input: number | null;
  readonly cached: number | null;
  readonly output: number | null;
  readonly contextTokens: number | null;
  readonly contextWindow: number | null;
  readonly compactions: number;
  readonly calls: number;
  readonly failures: number;
  readonly durationMs: number | null;
}

export interface PlacedNode extends GraphNode {
  readonly x: number;
  readonly y: number;
}

export interface GraphLayout {
  readonly nodes: readonly PlacedNode[];
  readonly width: number;
  readonly height: number;
}

function threadNode(thread: AgentThreadTelemetry): GraphNode {
  const split = splitOf(thread.usage);

  return {
    id: thread.threadId,
    parentId: thread.parentThreadId,
    kind: thread.parentThreadId === null ? "main" : "subagent",
    title: thread.path,
    model: thread.model,
    status: thread.status,
    tokens: split.fresh,
    input: split.fresh - split.output,
    cached: split.cached,
    output: split.output,
    contextTokens: thread.contextTokens,
    contextWindow: thread.contextWindow,
    compactions: thread.compactions,
    calls: 0,
    failures: 0,
    durationMs:
      thread.endedAt === null ? null : thread.endedAt - thread.startedAt,
  };
}

function serverNodes(steps: readonly StepEntry[]): GraphNode[] {
  const byServer = new Map<string, GraphNode>();
  for (const { step } of steps) {
    if (step.kind !== "tool_call" || step.server === WORKER_SERVER) {
      continue;
    }

    const id = `server:${step.threadId}:${step.server}`;
    const current = byServer.get(id);
    const running = step.status === "running";
    byServer.set(id, {
      id,
      parentId: step.threadId,
      kind: "server",
      title: step.server,
      model: null,
      status:
        running || current?.status === "running"
          ? "running"
          : (current?.status ?? "completed"),
      tokens: null,
      input: null,
      cached: null,
      output: null,
      contextTokens: null,
      contextWindow: null,
      compactions: 0,
      calls: (current?.calls ?? 0) + (running ? 0 : 1),
      failures: (current?.failures ?? 0) + (step.status === "failed" ? 1 : 0),
      durationMs: (current?.durationMs ?? 0) + (step.durationMs ?? 0),
    });
  }

  return [...byServer.values()];
}

function workerNode(
  telemetry: AgentTelemetry,
  steps: readonly StepEntry[],
  parentId: string,
): GraphNode | undefined {
  const calls = steps.filter(
    ({ step }) => step.kind === "tool_call" && step.server === WORKER_SERVER,
  );
  if (calls.length === 0 && telemetry.worker.calls === 0) {
    return undefined;
  }

  const running = calls.some(({ step }) => step.status === "running");

  return {
    id: "worker",
    parentId,
    kind: "worker",
    title: null,
    model: telemetry.workerModel,
    status: running ? "running" : "completed",
    tokens: telemetry.worker.input + telemetry.worker.output,
    input: telemetry.worker.input,
    cached: null,
    output: telemetry.worker.output,
    contextTokens: null,
    contextWindow: null,
    compactions: 0,
    calls: telemetry.worker.calls,
    failures: calls.filter(({ step }) => step.status === "failed").length,
    durationMs: telemetry.worker.durationMs,
  };
}

export function layoutGraph(
  telemetry: AgentTelemetry,
  steps: readonly StepEntry[],
): GraphLayout {
  const threads = telemetry.threads.map(threadNode);
  const main = threads.find((node) => node.kind === "main");
  const worker =
    main === undefined ? undefined : workerNode(telemetry, steps, main.id);
  const all = [
    ...threads,
    ...(worker === undefined ? [] : [worker]),
    ...serverNodes(steps),
  ];

  const known = new Set(all.map((node) => node.id));
  const children = new Map<string, GraphNode[]>();
  const roots: GraphNode[] = [];
  for (const node of all) {
    if (node.parentId === null || !known.has(node.parentId)) {
      roots.push(node);
      continue;
    }
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  }

  const placed: PlacedNode[] = [];
  let nextSlot = 0;
  let depthMax = 0;
  const place = (node: GraphNode, depth: number): number => {
    depthMax = Math.max(depthMax, depth);
    const kids = children.get(node.id) ?? [];
    const centers = kids.map((kid) => place(kid, depth + 1));
    const center =
      centers.length === 0
        ? nextSlot++
        : ((centers[0] ?? 0) + (centers[centers.length - 1] ?? 0)) / 2;
    placed.push({
      ...node,
      x: center * (NODE_WIDTH + GAP_X),
      y: depth * (NODE_HEIGHT + GAP_Y),
    });

    return center;
  };
  for (const root of roots) {
    place(root, 0);
  }

  return {
    nodes: placed,
    width: Math.max(1, nextSlot) * (NODE_WIDTH + GAP_X) - GAP_X,
    height: (depthMax + 1) * (NODE_HEIGHT + GAP_Y) - GAP_Y,
  };
}
