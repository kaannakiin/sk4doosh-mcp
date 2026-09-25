import type { IntegrationSummary } from "@chat/contracts/integration/registration";
import { useTranslation } from "react-i18next";

import { statusGroupOf } from "./grouping";

const DOT = {
  attention: "bg-amber",
  connected: "bg-green",
  disconnected: "bg-hairline-strong",
} as const;

interface StatusMarkProps {
  readonly integration: IntegrationSummary;
}

export function StatusMark({ integration }: StatusMarkProps) {
  const { t } = useTranslation();
  const group = statusGroupOf(integration);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span
        className={`size-1.5 shrink-0 rounded-full ${DOT[group]}`}
        aria-hidden
      />
      <span className={group === "attention" ? "text-amber" : "text-ink-dim"}>
        {integration.authMode === "none"
          ? t("connections.status.open")
          : t(
              `connections.status.${integration.connection?.status ?? "disconnected"}`,
            )}
      </span>
    </span>
  );
}
