import type { Locale } from "@chat/contracts/common/locale";
import type { IntegrationSummary } from "@chat/contracts/integration/registration";
import { Badge, Button } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { ApprovedToolList } from "./ApprovedToolList";
import { IntegrationApprovalModeField } from "./IntegrationApprovalModeField";
import { IntegrationToolList } from "./IntegrationToolList";

interface IntegrationCardProps {
  readonly integration: IntegrationSummary;
  readonly busy: boolean;
  readonly locale: Locale;
  readonly expanded: boolean;
  readonly onToggleApprovals: () => void;
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
  readonly onRefresh: () => void;
  readonly onRemove: () => void;
}

function hostOf(mcpUrl: string): string {
  try {
    return new URL(mcpUrl).host;
  } catch {
    return mcpUrl;
  }
}

export function IntegrationCard({
  integration,
  busy,
  locale,
  expanded,
  onToggleApprovals,
  onConnect,
  onDisconnect,
  onRefresh,
  onRemove,
}: IntegrationCardProps) {
  const { t } = useTranslation();
  const status = integration.connection?.status;
  const connected = status === "active";

  /**
   * Guard: a server that asks for no credential has no authorization server to
   * send the reader to, so it is never offered a connect button. Pressing one
   * would start a flow against an endpoint that does not exist.
   */
  const open = integration.authMode === "none";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline px-4 py-3">
      <div className="min-w-0 grow">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">
            {integration.displayName}
          </span>
          <Badge
            size="sm"
            variant="light"
            color={connected ? "var(--color-green)" : "var(--color-ink-dim)"}
          >
            {t(
              open
                ? "connections.status.open"
                : `connections.status.${status ?? "disconnected"}`,
            )}
          </Badge>
        </div>
        <p className="truncate text-xs text-ink-dim">
          {hostOf(integration.mcpUrl)}
          {" · "}
          {t("connections.tools.count", { count: integration.toolCount })}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="xs"
          radius="md"
          variant="subtle"
          onClick={onToggleApprovals}
        >
          {t(
            expanded
              ? "connections.approvals.hide"
              : "connections.approvals.show",
          )}
        </Button>
        <Button
          size="xs"
          radius="md"
          variant="subtle"
          disabled={busy}
          onClick={onRefresh}
        >
          {t("connections.actions.refreshTools")}
        </Button>
        {open ? null : connected ? (
          <Button
            size="xs"
            radius="md"
            variant="default"
            disabled={busy}
            onClick={onDisconnect}
          >
            {t("connections.actions.disconnect")}
          </Button>
        ) : (
          <Button size="xs" radius="md" disabled={busy} onClick={onConnect}>
            {t(
              status === "reauth_required"
                ? "connections.actions.reconnect"
                : "connections.actions.connect",
            )}
          </Button>
        )}
        {integration.origin === "user" ? (
          <Button
            size="xs"
            radius="md"
            variant="subtle"
            color="var(--color-red)"
            disabled={busy}
            onClick={onRemove}
          >
            {t("connections.actions.remove")}
          </Button>
        ) : null}
      </div>

      <div className="w-full">
        <IntegrationApprovalModeField
          integrationId={integration.id}
          mode={integration.approvalMode}
          locale={locale}
        />
      </div>

      {/*
        Mounted only while open: the lists are two more requests per card, and a
        reader with a dozen servers would otherwise pay for them on a page where
        every list is collapsed.
      */}
      {expanded ? (
        <div className="flex w-full flex-col gap-3 border-t border-hairline pt-2">
          <section>
            <h3 className="text-xs font-medium">
              {t("connections.toolList.title")}
            </h3>
            <IntegrationToolList
              integrationId={integration.id}
              locale={locale}
            />
          </section>
          <section>
            <h3 className="text-xs font-medium">
              {t("connections.approvals.title")}
            </h3>
            <ApprovedToolList integrationId={integration.id} locale={locale} />
          </section>
        </div>
      ) : null}
    </div>
  );
}
