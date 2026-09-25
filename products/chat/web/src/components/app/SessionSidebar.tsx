import { PRODUCT_NAME } from "@chat/contracts/common/product";
import { SESSION_PIN_LIMIT } from "@chat/contracts/chat/session-limits";
import type { SessionSummary } from "@chat/contracts/chat/session-record";
import {
  useDeleteSession,
  useRenameSession,
  useSetSessionPinned,
} from "@chat/queries/sessions/mutations";
import { useSessionList } from "@chat/queries/sessions/list";
import { Button, Loader, Modal, Text } from "@mantine/core";
import { IconPencilPlus, IconPlug } from "@tabler/icons-react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useInfiniteSentinel } from "~/core/hooks/use-infinite-sentinel";
import { useLocale } from "~/core/hooks/use-locale";
import { AccountMenu } from "./AccountMenu";
import { SessionRow } from "./SessionRow";

const NAV_ROW =
  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink no-underline hover:bg-raised";

const HEADING = "px-3 pt-5 pb-1.5 text-xs font-medium text-ink-dim";

const NO_SESSIONS: readonly SessionSummary[] = [];

export interface SessionSidebarProps {
  readonly onNavigate: () => void;
  readonly controls?: ReactNode;
}

export function SessionSidebar({ onNavigate, controls }: SessionSidebarProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const list = useSessionList({ locale });
  const { mutate: rename } = useRenameSession(locale);
  const { mutate: setPinned } = useSetSessionPinned(locale);
  const remove = useDeleteSession(locale);

  const [deleting, setDeleting] = useState<SessionSummary | undefined>();

  const sentinel = useInfiniteSentinel({
    hasNextPage: list.hasNextPage,
    isFetchingNextPage: list.isFetchingNextPage,
    fetchNextPage: list.fetchNextPage,
  });

  const pinned = list.data?.pinned ?? NO_SESSIONS;
  const recents = list.data?.recents ?? NO_SESSIONS;
  const pinLimitReached = pinned.length >= SESSION_PIN_LIMIT;

  const togglePin = useCallback(
    (session: SessionSummary) => {
      setPinned({ session, pinned: session.pinnedAt === null });
    },
    [setPinned],
  );

  const renameTo = useCallback(
    (session: SessionSummary, title: string) => {
      rename({ sessionId: session.id, title });
    },
    [rename],
  );

  const renderRow = (session: SessionSummary) => (
    <SessionRow
      key={session.id}
      session={session}
      active={params.sessionId === session.id}
      pinLimitReached={pinLimitReached}
      onTogglePin={togglePin}
      onRename={renameTo}
      onDelete={setDeleting}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex min-h-7 items-center justify-between gap-2 px-3.5 pt-3.5 pb-2">
        <Link
          to="/"
          className="font-serif text-[1.0625rem] font-medium tracking-[0.01em] text-ink no-underline"
          onClick={onNavigate}
        >
          {PRODUCT_NAME}
        </Link>
        {controls}
      </div>

      <div className="flex flex-col gap-px px-2">
        <Link to="/" className={NAV_ROW} onClick={onNavigate}>
          <IconPencilPlus size={17} stroke={1.6} />
          {t("sessions.new")}
        </Link>
        <Link
          to="/connections"
          className={`${NAV_ROW} data-[status=active]:bg-raised`}
          onClick={onNavigate}
        >
          <IconPlug size={17} stroke={1.6} />
          {t("connections.title")}
        </Link>
      </div>

      <nav
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3"
        aria-label={t("sessions.title")}
      >
        {pinned.length === 0 ? null : (
          <section>
            <h2 className={HEADING}>{t("sessions.pinned")}</h2>
            <ul className="flex flex-col gap-px">{pinned.map(renderRow)}</ul>
          </section>
        )}

        <section>
          <h2 className={HEADING}>{t("sessions.recents")}</h2>
          {list.isPending ? (
            <div className="px-3 py-2">
              <Loader size="xs" />
            </div>
          ) : null}

          {!list.isPending && recents.length === 0 ? (
            <p className="px-3 py-2 text-[0.8125rem] text-ink-dim">
              {t("sessions.empty")}
            </p>
          ) : null}

          <ul className="flex flex-col gap-px">{recents.map(renderRow)}</ul>

          <div ref={sentinel} aria-hidden />
          {list.isFetchingNextPage ? (
            <div className="px-3 py-2">
              <Loader size="xs" />
            </div>
          ) : null}
        </section>
      </nav>

      <div className="border-t border-hairline px-2 py-2">
        <AccountMenu />
      </div>

      <Modal
        opened={deleting !== undefined}
        onClose={() => {
          setDeleting(undefined);
        }}
        title={t("sessions.delete")}
        centered
      >
        <Text size="sm" c="var(--color-ink-dim)">
          {t("sessions.deleteConfirm", {
            title: deleting?.title ?? t("sessions.untitled"),
          })}
        </Text>
        <Button
          mt="md"
          fullWidth
          color="red"
          loading={remove.isPending}
          onClick={submitDelete}
        >
          {t("sessions.delete")}
        </Button>
      </Modal>
    </div>
  );

  /**
   * Guard: deleting the conversation on screen navigates away first. Its route
   * would otherwise re-request a session the api has just soft deleted, and open
   * it as an empty new chat under the old id.
   */
  function submitDelete() {
    const target = deleting;
    if (target === undefined) {
      return;
    }
    remove.mutate(target.id);
    setDeleting(undefined);
    if (params.sessionId === target.id) {
      void navigate({ to: "/", replace: true });
    }
  }
}
