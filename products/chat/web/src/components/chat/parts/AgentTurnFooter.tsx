import type { AgentTelemetry } from "@chat/contracts/agent/stream-parts";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "~/core/hooks/use-locale";
import { asCompact } from "~/core/text/count";
import { asClock } from "~/core/text/duration";
import { durationOf } from "~/lib/agent-parts";
import { turnTokens } from "~/lib/agent-session";

export interface AgentTurnFooterProps {
  readonly telemetry: AgentTelemetry;
}

function AgentTurnFooterComponent({ telemetry }: AgentTurnFooterProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const duration = durationOf(telemetry);
  const agents = telemetry.threads.length;
  const tokens = turnTokens(telemetry);

  const facts = [
    telemetry.model,
    telemetry.effort,
    t("agents.freshTokens", {
      fresh: asCompact(tokens.fresh, locale),
      cached: asCompact(tokens.cached, locale),
    }),
    agents > 1 ? t("agents.agents", { count: agents }) : null,
    telemetry.worker.calls > 0
      ? `${t("agents.worker")} ${t("agents.calls", { count: telemetry.worker.calls })}`
      : null,
    duration === undefined ? null : asClock(duration),
  ].filter((fact): fact is string => fact !== null && fact !== "");

  return (
    <p className="mt-2 font-mono text-[0.6875rem] text-ink-dim">
      {facts.join(" · ")}
    </p>
  );
}

export const AgentTurnFooter = memo(AgentTurnFooterComponent);
