import type { Locale } from "@chat/contracts/common/locale";
import { Modal, Text } from "@mantine/core";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { asCompact } from "~/core/text/count";
import { asClock } from "~/core/text/duration";
import type { TurnTelemetry } from "~/lib/agent-parts";
import { summarizeSession, type SessionSummary } from "~/lib/agent-session";

import { AgentGraph } from "./AgentGraph";
import { TurnTimeline } from "./TurnTimeline";

export interface AgentActivityDialogProps {
  readonly opened: boolean;
  readonly onClose: () => void;
  readonly turns: readonly TurnTelemetry[];
  readonly locale: Locale;
}

const RATE_WARNING_PERCENT = 90;

function Stat({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: string; hint?: string }>) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-hairline bg-raised px-3.5 py-2.5">
      <span className="text-[0.6875rem] tracking-wide text-ink-dim uppercase">
        {label}
      </span>
      <span className="font-mono text-lg leading-tight tabular-nums text-ink">
        {value}
      </span>
      {hint === undefined ? null : (
        <span className="text-[0.6875rem] text-ink-dim">{hint}</span>
      )}
    </div>
  );
}

export function AgentActivityDialog({
  opened,
  onClose,
  turns,
  locale,
}: AgentActivityDialogProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => summarizeSession(turns), [turns]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="auto"
      radius="lg"
      title={
        <span className="text-base font-semibold">{t("agents.title")}</span>
      }
      classNames={{ body: "min-w-[min(92vw,720px)] max-w-[92vw]" }}
    >
      {summary === undefined ? (
        <Text size="sm" c="dimmed">
          {t("agents.empty")}
        </Text>
      ) : (
        <SessionView summary={summary} locale={locale} />
      )}
    </Modal>
  );
}

function SessionView({
  summary,
  locale,
}: Readonly<{ summary: SessionSummary; locale: Locale }>) {
  const { t } = useTranslation();
  const { telemetry, tokens, points } = summary;
  const rateLimit = telemetry.rateLimit;
  const input = tokens.cached + tokens.fresh - tokens.output;
  const cachedShare =
    input === 0 ? 0 : Math.round((tokens.cached / input) * 100);

  return (
    <div className="flex flex-col gap-4">
      <span className="font-mono text-xs text-ink-dim">
        {[
          telemetry.model,
          telemetry.effort,
          telemetry.workerModel,
          t("agents.turns", { count: points.length }),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat
          label={t("agents.usage.fresh")}
          value={asCompact(tokens.fresh, locale)}
          hint={t("agents.processed", {
            value: asCompact(tokens.processed, locale),
          })}
        />
        <Stat
          label={t("agents.usage.cached")}
          value={asCompact(tokens.cached, locale)}
          hint={`${String(cachedShare)}%`}
        />
        <Stat
          label={t("agents.usage.output")}
          value={asCompact(tokens.output, locale)}
          hint={t("agents.agents", { count: telemetry.threads.length })}
        />
        <Stat
          label={t("agents.duration")}
          value={asClock(summary.durationMs)}
          hint={
            telemetry.worker.calls === 0
              ? undefined
              : `${t("agents.worker")} ${asClock(telemetry.worker.durationMs)}`
          }
        />
      </div>

      {rateLimit === null ? null : (
        <div className="flex items-center gap-3 text-xs text-ink-dim">
          <span className="shrink-0">
            {t("agents.rateLimit", {
              percent: Math.round(rateLimit.usedPercent),
            })}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, rateLimit.usedPercent)}%`,
                background:
                  rateLimit.usedPercent >= RATE_WARNING_PERCENT
                    ? "var(--chat-red)"
                    : "var(--chat-accent)",
              }}
            />
          </div>
          {rateLimit.resetsAt === null ? null : (
            <span className="shrink-0">
              {t("agents.resets", {
                when: new Date(rateLimit.resetsAt * 1000).toLocaleString(
                  locale,
                  { dateStyle: "medium", timeStyle: "short" },
                ),
              })}
            </span>
          )}
        </div>
      )}

      {points.length < 2 ? null : (
        <TurnTimeline points={points} locale={locale} />
      )}

      <AgentGraph telemetry={telemetry} steps={summary.steps} locale={locale} />
    </div>
  );
}
