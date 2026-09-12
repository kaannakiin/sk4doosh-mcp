import type { SessionSummary } from "@chat/contracts/chat/session-record";
import { sessionDetailOptions } from "@chat/queries/sessions/detail";
import { useChatClient } from "@chat/queries/provider";
import { ActionIcon, Menu } from "@mantine/core";
import { IconDots, IconPencil, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { formatRelative } from "../../lib/relative-time";
import { useLocale } from "../../lib/use-locale";

export interface SessionRowProps {
  readonly session: SessionSummary;
  readonly active: boolean;
  readonly onRename: (session: SessionSummary) => void;
  readonly onDelete: (session: SessionSummary) => void;
  readonly onNavigate: () => void;
}

function SessionRowComponent({
  session,
  active,
  onRename,
  onDelete,
  onNavigate,
}: SessionRowProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const client = useChatClient();

  /**
   * Guard: hovering warms the conversation, not just the route. The chat surface
   * cannot mount until its history has arrived — `useChat` reads `messages` once
   * — so without this the visitor watches a skeleton on every switch.
   */
  const warm = () => {
    void queryClient.prefetchQuery(
      sessionDetailOptions(client, session.id, locale),
    );
  };

  return (
    <div
      className="group relative flex items-center rounded-lg hover:bg-raised focus-within:bg-raised data-active:bg-accent-soft"
      data-active={active ? "" : undefined}
    >
      {active ? (
        <span
          className="absolute inset-y-1.5 inset-s-0 w-0.5 rounded-sm bg-accent"
          aria-hidden
        />
      ) : null}

      <Link
        to="/c/$sessionId"
        params={{ sessionId: session.id }}
        className="flex min-w-0 flex-1 flex-col gap-px py-2 pe-1 ps-2.5 text-inherit no-underline"
        onPointerEnter={warm}
        onFocus={warm}
        onClick={onNavigate}
      >
        <span className="truncate text-sm leading-tight">
          {session.title ?? t("sessions.untitled")}
        </span>
        <span className="text-xs text-ink-dim">
          {formatRelative(session.updatedAt, locale)}
        </span>
      </Link>

      <Menu position="bottom-end" withinPortal shadow="sm">
        <Menu.Target>
          <ActionIcon
            className="me-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={t("sessions.actions")}
          >
            <IconDots size={15} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconPencil size={14} />}
            onClick={() => {
              onRename(session);
            }}
          >
            {t("sessions.rename")}
          </Menu.Item>
          <Menu.Item
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => {
              onDelete(session);
            }}
          >
            {t("sessions.delete")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </div>
  );
}

export const SessionRow = memo(SessionRowComponent);
