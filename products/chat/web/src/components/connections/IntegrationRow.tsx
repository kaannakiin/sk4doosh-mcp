import type { Locale } from "@chat/contracts/common/locale";
import type { IntegrationSummary } from "@chat/contracts/integration/registration";
import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { formatRelative } from "~/lib/relative-time";

import { ConnectButton } from "./ConnectButton";
import { hostOf, statusGroupOf } from "./grouping";
import {
  IntegrationRowMenu,
  type IntegrationActions,
} from "./IntegrationRowMenu";
import { StatusMark } from "./StatusMark";

interface IntegrationRowProps extends IntegrationActions {
  readonly integration: IntegrationSummary;
  readonly busy: boolean;
  readonly locale: Locale;
}

/**
 * Guard: the name's link stretches over the row through an `after:` box against
 * the `relative` row, and every other control sits above it with `z-10`. Making
 * the row itself clickable would leave it out of the tab order and hide it from
 * the router's intent preload, which listens on the anchor.
 */
function IntegrationRowComponent({
  integration,
  busy,
  locale,
  onRefresh,
  onDisconnect,
  onRemove,
}: IntegrationRowProps) {
  const { t } = useTranslation();
  const attention = statusGroupOf(integration) === "attention";
  const lastUsed = integration.connection?.lastUsedAt ?? null;

  return (
    <tr className="group relative border-t border-hairline transition-colors hover:bg-raised focus-within:bg-raised">
      <td
        className={`max-w-0 py-3 ps-4 pe-3 ${attention ? "shadow-[inset_2px_0_0_var(--color-amber)]" : ""}`}
      >
        <Link
          to="/connections/$integrationId"
          params={{ integrationId: integration.id }}
          className="block min-w-0 text-inherit no-underline outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-accent"
        >
          <span className="block truncate font-medium">
            {integration.displayName}
          </span>
          <span className="block truncate font-mono text-xs text-ink-dim">
            {hostOf(integration.mcpUrl)}
          </span>
        </Link>
      </td>
      <td className="px-3 py-3">
        <StatusMark integration={integration} compact />
      </td>
      <td className="hidden px-3 py-3 text-end font-mono text-xs tabular-nums sm:table-cell">
        {integration.toolCount}
      </td>
      <td
        className={`hidden px-3 py-3 text-xs md:table-cell ${integration.approvalMode === "auto" ? "text-amber" : "text-ink-dim"}`}
      >
        {t(`connections.integrationMode.${integration.approvalMode}`)}
      </td>
      <td className="hidden px-3 py-3 text-xs whitespace-nowrap text-ink-dim md:table-cell">
        {lastUsed === null
          ? t("connections.table.never")
          : formatRelative(lastUsed, locale)}
      </td>
      <td className="py-2 ps-3 pe-2">
        <div className="relative z-10 flex items-center justify-end gap-1.5">
          <ConnectButton integration={integration} />
          <IntegrationRowMenu
            integration={integration}
            busy={busy}
            onRefresh={onRefresh}
            onDisconnect={onDisconnect}
            onRemove={onRemove}
          />
        </div>
      </td>
    </tr>
  );
}

export const IntegrationRow = memo(IntegrationRowComponent);
