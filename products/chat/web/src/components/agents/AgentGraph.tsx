import type { AgentTelemetry } from "@chat/contracts/agent/stream-parts";
import type { Locale } from "@chat/contracts/common/locale";
import {
  IconCpu,
  IconPlug,
  IconRobot,
  IconTopologyStar3,
} from "@tabler/icons-react";
import { createElement, memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { asCompact } from "~/core/text/count";
import { asClock } from "~/core/text/duration";
import type { StepEntry } from "~/lib/agent-parts";

import {
  layoutGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  type GraphNodeKind,
  type GraphStatus,
  type PlacedNode,
} from "./agent-graph";

export interface AgentGraphProps {
  readonly telemetry: AgentTelemetry;
  readonly steps: readonly StepEntry[];
  readonly locale: Locale;
}

const KIND_STYLE: Readonly<
  Record<GraphNodeKind, { color: string; icon: typeof IconRobot }>
> = {
  main: { color: "var(--chat-accent)", icon: IconTopologyStar3 },
  subagent: { color: "var(--chat-amber)", icon: IconRobot },
  worker: { color: "var(--chat-amber)", icon: IconCpu },
  server: { color: "var(--chat-ink-dim)", icon: IconPlug },
};

const STATUS_COLOR: Readonly<Record<GraphStatus, string>> = {
  running: "var(--chat-accent)",
  completed: "var(--chat-green)",
  failed: "var(--chat-red)",
  interrupted: "var(--chat-ink-dim)",
};

function titleOf(node: PlacedNode, t: (key: string) => string): string {
  switch (node.kind) {
    case "main":
      return t("agents.main");
    case "subagent":
      return node.title ?? t("agents.subagent");
    case "worker":
      return t("agents.worker");
    case "server":
      return node.title ?? "";
  }
}

function edgeLabelOf(
  node: PlacedNode,
  locale: Locale,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (node.kind === "server" || node.kind === "worker") {
    return t("agents.calls", { count: node.calls });
  }

  return node.tokens === null
    ? ""
    : t("agents.tokens", { value: asCompact(node.tokens, locale) });
}

function metricOf(
  node: PlacedNode,
  locale: Locale,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (node.input === null || node.output === null) {
    return t("agents.calls", { count: node.calls });
  }
  if (node.cached === null) {
    return t("agents.workerTokens", {
      input: asCompact(node.input, locale),
      output: asCompact(node.output, locale),
    });
  }

  return t("agents.freshTokens", {
    fresh: asCompact(node.tokens ?? 0, locale),
    cached: asCompact(node.cached, locale),
  });
}

function edgePath(parent: PlacedNode, child: PlacedNode): string {
  const x1 = parent.x + NODE_WIDTH / 2;
  const y1 = parent.y + NODE_HEIGHT;
  const x2 = child.x + NODE_WIDTH / 2;
  const y2 = child.y - 6;
  const bend = (y2 - y1) / 2;

  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

function NodeCard({
  node,
  locale,
}: Readonly<{ node: PlacedNode; locale: Locale }>) {
  const { t } = useTranslation();
  const style = KIND_STYLE[node.kind];
  const running = node.status === "running";
  const context =
    node.contextTokens !== null && node.contextWindow !== null
      ? Math.min(100, (node.contextTokens / node.contextWindow) * 100)
      : undefined;

  return (
    <div
      className="absolute flex flex-col gap-1.5 overflow-hidden rounded-xl border border-hairline bg-panel px-3 py-2.5 text-xs shadow-sm"
      style={{
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        borderTop: `3px solid ${style.color}`,
      }}
    >
      <div className="flex items-center gap-1.5">
        {createElement(style.icon, {
          size: 15,
          className: "shrink-0",
          style: { color: style.color },
        })}
        <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-ink">
          {titleOf(node, t)}
        </span>
        <span
          className={
            running
              ? "size-2 shrink-0 animate-pulse rounded-full"
              : "size-2 shrink-0 rounded-full"
          }
          style={{ background: STATUS_COLOR[node.status] }}
          role="img"
          aria-label={t(`agents.status.${node.status}`)}
        />
      </div>

      {node.model === null ? (
        <span className="h-4" />
      ) : (
        <span className="truncate font-mono text-[0.6875rem] text-ink-dim">
          {node.model}
        </span>
      )}

      <div className="flex items-baseline justify-between gap-2 text-ink-dim">
        <span className="truncate">{metricOf(node, locale, t)}</span>
        {node.durationMs === null ? null : (
          <span className="shrink-0 font-mono tabular-nums">
            {asClock(node.durationMs)}
          </span>
        )}
      </div>

      {context === undefined ? null : (
        <div className="mt-auto flex flex-col gap-1">
          <div className="flex justify-between text-[0.6875rem] text-ink-dim">
            <span>
              {t("agents.context", {
                used: asCompact(node.contextTokens ?? 0, locale),
                window: asCompact(node.contextWindow ?? 0, locale),
              })}
            </span>
            {node.compactions === 0 ? null : (
              <span>
                {t("agents.compactions", { count: node.compactions })}
              </span>
            )}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full"
              style={{ width: `${context}%`, background: style.color }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AgentGraphComponent({ telemetry, steps, locale }: AgentGraphProps) {
  const { t } = useTranslation();
  const layout = useMemo(
    () => layoutGraph(telemetry, steps),
    [telemetry, steps],
  );
  const byId = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const edges = layout.nodes.flatMap((child) => {
    const parent =
      child.parentId === null ? undefined : byId.get(child.parentId);

    return parent === undefined ? [] : [{ parent, child }];
  });

  return (
    <div className="overflow-auto rounded-xl border border-hairline bg-surface p-6">
      <div
        className="relative mx-auto"
        style={{ width: layout.width, height: layout.height }}
      >
        <svg
          className="absolute inset-0 overflow-visible"
          width={layout.width}
          height={layout.height}
          aria-hidden
        >
          <defs>
            <marker
              id="agent-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                fill="var(--chat-hairline-strong)"
              />
            </marker>
          </defs>
          {edges.map(({ parent, child }) => (
            <path
              key={child.id}
              d={edgePath(parent, child)}
              fill="none"
              stroke={
                child.status === "running"
                  ? "var(--chat-accent)"
                  : "var(--chat-hairline-strong)"
              }
              strokeWidth={1.5}
              markerEnd="url(#agent-arrow)"
              className={
                child.status === "running" ? "agent-edge-live" : undefined
              }
            />
          ))}
        </svg>

        {edges.map(({ parent, child }) => {
          const label = edgeLabelOf(child, locale, t);

          return label === "" ? null : (
            <span
              key={`label:${child.id}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-hairline bg-panel px-2 py-0.5 font-mono text-[0.625rem] whitespace-nowrap text-ink-dim"
              style={{
                left: (parent.x + child.x) / 2 + NODE_WIDTH / 2,
                top: (parent.y + NODE_HEIGHT + child.y) / 2,
              }}
            >
              {label}
            </span>
          );
        })}

        {layout.nodes.map((node) => (
          <NodeCard key={node.id} node={node} locale={locale} />
        ))}
      </div>
    </div>
  );
}

export const AgentGraph = memo(AgentGraphComponent);
