import type { Locale } from "@chat/contracts/common/locale";
import { Tooltip } from "@mantine/core";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { asCompact } from "~/core/text/count";
import { asClock } from "~/core/text/duration";
import type { TurnPoint } from "~/lib/agent-session";

export interface TurnTimelineProps {
  readonly points: readonly TurnPoint[];
  readonly locale: Locale;
}

const BAR_HEIGHT = 64;

const LINE_HEIGHT = 40;

const LABEL_EVERY_MAX = 12;

function percentOf(point: TurnPoint): number | null {
  return point.contextTokens === null || point.contextWindow === null
    ? null
    : Math.min(100, (point.contextTokens / point.contextWindow) * 100);
}

function TurnTimelineComponent({ points, locale }: TurnTimelineProps) {
  const { t } = useTranslation();
  const peak = Math.max(1, ...points.map((point) => point.tokens.fresh));
  const step = Math.ceil(points.length / LABEL_EVERY_MAX);
  const columns = {
    gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
  };
  const line = points
    .map((point, index) => {
      const percent = percentOf(point);

      return percent === null
        ? null
        : `${index + 0.5},${(100 - percent).toFixed(2)}`;
    })
    .filter((entry): entry is string => entry !== null)
    .join(" ");

  const tooltipOf = (point: TurnPoint) => {
    const percent = percentOf(point);

    return (
      <div className="flex flex-col gap-0.5 text-xs">
        <span className="font-semibold">
          {t("agents.turnLabel", { index: point.index })}
        </span>
        <span>
          {t("agents.freshTokens", {
            fresh: asCompact(point.tokens.fresh, locale),
            cached: asCompact(point.tokens.cached, locale),
          })}
        </span>
        {percent === null ? null : (
          <span>
            {t("agents.context", {
              used: asCompact(point.contextTokens ?? 0, locale),
              window: asCompact(point.contextWindow ?? 0, locale),
            })}
            {point.compactions === 0
              ? null
              : ` · ${t("agents.compactions", { count: point.compactions })}`}
          </span>
        )}
        {point.durationMs === null ? null : (
          <span>{asClock(point.durationMs)}</span>
        )}
      </div>
    );
  };

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <figcaption className="text-xs font-medium text-ink">
          {t("agents.timeline.spend")}
        </figcaption>
        <div
          className="grid items-end gap-[2px] border-b border-hairline-strong"
          style={{ ...columns, height: BAR_HEIGHT }}
        >
          {points.map((point) => (
            <Tooltip key={point.messageId} label={tooltipOf(point)} withArrow>
              <div className="flex h-full items-end">
                <div
                  className="w-full rounded-t-[4px]"
                  style={{
                    height: `${Math.max(2, (point.tokens.fresh / peak) * 100)}%`,
                    background: "var(--chat-accent)",
                  }}
                />
              </div>
            </Tooltip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink">
          {t("agents.timeline.context")}
        </span>
        <div className="relative" style={{ height: LINE_HEIGHT }}>
          <svg
            className="absolute inset-0 size-full overflow-visible"
            viewBox={`0 0 ${points.length} 100`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <line
              x1={0}
              x2={points.length}
              y1={100}
              y2={100}
              stroke="var(--chat-hairline-strong)"
              vectorEffect="non-scaling-stroke"
            />
            {line === "" ? null : (
              <polyline
                points={line}
                fill="none"
                stroke="var(--chat-amber)"
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <div className="absolute inset-0 grid" style={columns}>
            {points.map((point) => {
              const percent = percentOf(point);

              return (
                <Tooltip
                  key={point.messageId}
                  label={tooltipOf(point)}
                  withArrow
                >
                  <div className="relative h-full">
                    {percent === null ? null : (
                      <span
                        className={
                          point.compactions === 0
                            ? "absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel"
                            : "absolute left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ring-2 ring-panel"
                        }
                        style={{
                          top: `${100 - percent}%`,
                          background:
                            point.compactions === 0
                              ? "var(--chat-amber)"
                              : "var(--chat-panel)",
                          borderColor: "var(--chat-amber)",
                        }}
                      />
                    )}
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="grid font-mono text-[0.625rem] text-ink-dim"
        style={columns}
      >
        {points.map((point, index) => (
          <span key={point.messageId} className="text-center">
            {index % step === 0 ? point.index : ""}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>{t("agents.timeline.spend")}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.messageId}>
              <th scope="row">
                {t("agents.turnLabel", { index: point.index })}
              </th>
              <td>{point.tokens.fresh}</td>
              <td>{point.tokens.cached}</td>
              <td>{percentOf(point)?.toFixed(0) ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export const TurnTimeline = memo(TurnTimelineComponent);
