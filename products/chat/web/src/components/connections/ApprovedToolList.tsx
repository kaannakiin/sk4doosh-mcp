import type { Locale } from "@chat/contracts/common/locale";
import { useIntegrationApprovals } from "@chat/queries/connections/approvals";
import { useForgetTool } from "@chat/queries/connections/mutations";
import { Badge, Button, Loader } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { formatRelative } from "~/lib/relative-time";

interface ApprovedToolListProps {
  readonly integrationId: string;
  readonly locale: Locale;
}

export function ApprovedToolList({
  integrationId,
  locale,
}: ApprovedToolListProps) {
  const { t } = useTranslation();
  const approvals = useIntegrationApprovals(integrationId, locale, true);
  const forget = useForgetTool(locale);

  if (approvals.isPending) {
    return (
      <p className="flex items-center gap-2 px-1 py-2 text-xs text-ink-dim">
        <Loader size="xs" />
        {t("connections.approvals.loading")}
      </p>
    );
  }

  if (approvals.data === undefined || approvals.data.length === 0) {
    return (
      <p className="px-1 py-2 text-xs text-ink-dim">
        {t("connections.approvals.empty")}
      </p>
    );
  }

  return (
    <ul className="w-full divide-y divide-hairline">
      {approvals.data.map((approval) => (
        <li
          key={approval.toolName}
          className="flex flex-wrap items-center gap-2 py-2"
        >
          <span className="min-w-0 grow truncate font-mono text-xs">
            {approval.toolName}
          </span>
          {approval.destructive ? (
            <Badge size="xs" variant="light" color="var(--color-amber)">
              {t("connections.approvals.destructive")}
            </Badge>
          ) : null}
          {approval.definitionChanged ? (
            <Badge size="xs" variant="light" color="var(--color-amber)">
              {t("connections.approvals.changed")}
            </Badge>
          ) : null}
          {approval.available ? null : (
            <Badge size="xs" variant="light" color="var(--color-ink-dim)">
              {t("connections.approvals.withdrawn")}
            </Badge>
          )}
          <span className="text-xs whitespace-nowrap text-ink-dim">
            {t("connections.approvals.grantedAt", {
              when: formatRelative(approval.approvedAt, locale),
            })}
          </span>
          <Button
            size="xs"
            radius="md"
            variant="subtle"
            color="var(--color-red)"
            disabled={forget.isPending}
            onClick={() => {
              forget.mutate(approval.exposedName);
            }}
          >
            {t("connections.approvals.forget")}
          </Button>
        </li>
      ))}
    </ul>
  );
}
