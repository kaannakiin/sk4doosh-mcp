import { SESSION_TITLE_MAX_LENGTH } from "@chat/contracts/chat/session-limits";
import type { SessionSummary } from "@chat/contracts/chat/session-record";
import {
  useDeleteSession,
  useRenameSession,
} from "@chat/queries/sessions/mutations";
import { useSessionList } from "@chat/queries/sessions/list";
import { Button, Loader, Modal, Text, TextInput } from "@mantine/core";
import { IconPencilPlus } from "@tabler/icons-react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../lib/use-locale";
import { LocaleSwitcher } from "../LocaleSwitcher";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { SessionRow } from "./SessionRow";

export interface SessionSidebarProps {
  readonly onNavigate: () => void;
}

export function SessionSidebar({ onNavigate }: SessionSidebarProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const list = useSessionList({ locale });
  const rename = useRenameSession(locale);
  const remove = useDeleteSession(locale);

  const [renaming, setRenaming] = useState<SessionSummary | undefined>();
  const [deleting, setDeleting] = useState<SessionSummary | undefined>();
  const [draft, setDraft] = useState("");

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;

  /**
   * Guard: the observer is rebuilt whenever paging state changes, because the
   * callback closes over `hasNextPage`. Keeping one observer alive across a page
   * load leaves it asking for a page that no longer exists.
   */
  useEffect(() => {
    const node = sentinel.current;
    if (node === null || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage();
      }
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const sessions = list.data ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex flex-col gap-3 px-3.5 pt-4.5 pb-3.5">
        <Link
          to="/"
          className="font-serif text-[1.0625rem] font-medium tracking-[0.01em] text-ink no-underline"
          onClick={onNavigate}
        >
          {t("app.title")}
        </Link>
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-lg border border-hairline bg-accent-soft px-3 py-2 text-[0.8125rem] text-ink no-underline hover:border-accent"
        >
          <IconPencilPlus size={15} />
          {t("sessions.new")}
        </Link>
      </div>

      <nav
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
        aria-label={t("sessions.title")}
      >
        {list.isPending ? (
          <div className="px-1.5 py-3">
            <Loader size="xs" />
          </div>
        ) : null}

        {!list.isPending && sessions.length === 0 ? (
          <p className="px-1.5 py-3 text-[0.8125rem] text-ink-dim">
            {t("sessions.empty")}
          </p>
        ) : null}

        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            active={params.sessionId === session.id}
            onRename={(target) => {
              setDraft(target.title ?? "");
              setRenaming(target);
            }}
            onDelete={setDeleting}
            onNavigate={onNavigate}
          />
        ))}

        <div ref={sentinel} aria-hidden />
        {isFetchingNextPage ? (
          <div className="px-1.5 py-3">
            <Loader size="xs" />
          </div>
        ) : null}
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-hairline px-3.5 py-2.5">
        <LocaleSwitcher />
        <ThemeSwitcher />
      </div>

      <Modal
        opened={renaming !== undefined}
        onClose={() => {
          setRenaming(undefined);
        }}
        title={t("sessions.rename")}
        centered
      >
        <TextInput
          value={draft}
          maxLength={SESSION_TITLE_MAX_LENGTH}
          autoFocus
          aria-label={t("sessions.titleLabel")}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              submitRename();
            }
          }}
        />
        <Button
          mt="md"
          fullWidth
          disabled={draft.trim().length === 0}
          loading={rename.isPending}
          onClick={submitRename}
        >
          {t("sessions.save")}
        </Button>
      </Modal>

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

  function submitRename() {
    const target = renaming;
    const title = draft.trim();
    if (target === undefined || title.length === 0) {
      return;
    }
    rename.mutate({ sessionId: target.id, title });
    setRenaming(undefined);
  }

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
