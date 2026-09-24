import type { Locale } from "@chat/contracts/common/locale";
import { useChatToolApprovals } from "@chat/queries/connections/approvals";
import { useForgetTool } from "@chat/queries/connections/mutations";
import { Badge, Button, Loader } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { formatRelative } from "~/lib/relative-time";

interface ChatToolApprovalListProps {
  readonly locale: Locale;
}

/**
 * The grants a reader holds for the tools this product ships.
 *
 * Guard: a section of its own rather than a row on some integration's card.
 * These tools belong to no server, and for as long as the only listing was
 * per-integration there was nowhere to withdraw one — which is half the reason
 * they could not be remembered in the first place.
 */
export function ChatToolApprovalList({ locale }: ChatToolApprovalListProps) {
  const { t } = useTranslation();
  const approvals = useChatToolApprovals(locale, true);
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
        {t("connections.approvals.chatEmpty")}
      </p>
    );
  }

  return (
    <ul className="w-full divide-y divide-hairline">
      {approvals.data.map((approval) => (
        <li
          key={approval.subjectKey}
          className="flex flex-wrap items-center gap-2 py-2"
        >
          <span className="min-w-0 grow truncate font-mono text-xs">
            {t(`tool.names.${approval.toolName}`, {
              defaultValue: approval.toolName,
            })}
          </span>
          <Badge size="xs" variant="light" color="var(--color-ink-dim)">
            {approval.conversation !== null &&
            approval.conversation.title !== null
              ? t("connections.approvals.scope.sessionNamed", {
                  title: approval.conversation.title,
                })
              : approval.scope === "session"
                ? t("connections.approvals.scope.session")
                : t("connections.approvals.scope.global")}
          </Badge>
          {approval.expired ? (
            <Badge size="xs" variant="light" color="var(--color-ink-dim)">
              {t("connections.approvals.expired")}
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
            {approval.expiresAt === null || approval.expired
              ? t("connections.approvals.grantedAt", {
                  when: formatRelative(approval.approvedAt, locale),
                })
              : t("connections.approvals.expiresAt", {
                  when: formatRelative(approval.expiresAt, locale),
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
