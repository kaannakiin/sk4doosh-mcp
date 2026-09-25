import { SESSION_TITLE_MAX_LENGTH } from "@chat/contracts/chat/session-limits";
import type { SessionSummary } from "@chat/contracts/chat/session-record";
import { useWarmSessionDetail } from "@chat/queries/sessions/detail";
import { ActionIcon, Menu, TextInput, Tooltip } from "@mantine/core";
import {
  IconCursorText,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconTrash,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "~/core/hooks/use-locale";
import { useMarquee } from "~/core/hooks/use-marquee";

export interface SessionRowProps {
  readonly session: SessionSummary;
  readonly active: boolean;
  readonly pinLimitReached: boolean;
  readonly onTogglePin: (session: SessionSummary) => void;
  readonly onRename: (session: SessionSummary, title: string) => void;
  readonly onDelete: (session: SessionSummary) => void;
  readonly onNavigate: () => void;
}

const ACTION =
  "text-ink-dim hover:text-ink data-disabled:cursor-not-allowed data-disabled:opacity-40";

/**
 * Guard: the edit menu has `returnFocus` off because Rename swaps the row for an
 * autofocused input. Handing focus back to the edit button blurs that input on
 * the same tick, and the blur commits the rename unchanged.
 */
function SessionRowComponent({
  session,
  active,
  pinLimitReached,
  onTogglePin,
  onRename,
  onDelete,
  onNavigate,
}: SessionRowProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const warm = useWarmSessionDetail(session.id, locale);
  const {
    ref: marqueeRef,
    start: startMarquee,
    stop: stopMarquee,
  } = useMarquee<HTMLSpanElement>();
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const title = session.title ?? t("sessions.untitled");
  const pinned = session.pinnedAt !== null;
  const pinBlocked = !pinned && pinLimitReached;

  return (
    <li
      className="group relative flex items-center gap-1 rounded-lg hover:bg-raised focus-within:bg-raised data-active:bg-raised"
      data-active={active ? "" : undefined}
      onPointerEnter={startMarquee}
      onPointerLeave={stopMarquee}
      onFocus={startMarquee}
      onBlur={stopMarquee}
    >
      {editing ? (
        <RenameField
          initial={session.title ?? ""}
          onDone={(next) => {
            setEditing(false);
            if (next !== undefined) {
              onRename(session, next);
            }
          }}
        />
      ) : (
        <Link
          to="/c/$sessionId"
          params={{ sessionId: session.id }}
          className="min-w-0 flex-1 py-2 ps-3 text-sm text-ink no-underline"
          onPointerEnter={warm}
          onFocus={warm}
          onClick={onNavigate}
        >
          <span ref={marqueeRef} className="chat-marquee block">
            <span>{title}</span>
          </span>
        </Link>
      )}

      {editing ? null : (
        <div
          className="hidden shrink-0 items-center pe-1.5 group-hover:flex group-focus-within:flex data-open:flex [@media(hover:none)]:flex"
          data-open={menuOpen ? "" : undefined}
        >
          <Tooltip
            label={
              pinBlocked
                ? t("sessions.pinLimit")
                : t(pinned ? "sessions.unpin" : "sessions.pin")
            }
            withArrow
            openDelay={400}
          >
            <ActionIcon
              className={ACTION}
              variant="subtle"
              color="gray"
              size="sm"
              data-disabled={pinBlocked || undefined}
              aria-disabled={pinBlocked || undefined}
              aria-label={t(pinned ? "sessions.unpin" : "sessions.pin")}
              onClick={() => {
                if (!pinBlocked) {
                  onTogglePin(session);
                }
              }}
            >
              {pinned ? <IconPinnedOff size={15} /> : <IconPin size={15} />}
            </ActionIcon>
          </Tooltip>

          <Menu
            position="bottom-end"
            withinPortal
            shadow="sm"
            returnFocus={false}
            opened={menuOpen}
            onChange={setMenuOpen}
          >
            <Menu.Target>
              <ActionIcon
                className={ACTION}
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t("sessions.edit")}
              >
                <IconPencil size={15} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconCursorText size={14} />}
                onClick={() => {
                  setEditing(true);
                }}
              >
                {t("sessions.rename")}
              </Menu.Item>
              <Menu.Divider />
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
      )}
    </li>
  );
}

interface RenameFieldProps {
  readonly initial: string;
  readonly onDone: (title: string | undefined) => void;
}

/**
 * Guard: `settled` makes the first of Enter, Escape and blur win. Enter unmounts
 * the input, and the blur that removal fires would otherwise commit a second
 * time — or commit after an Escape that meant to discard.
 */
function RenameField({ initial, onDone }: RenameFieldProps) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    input.current?.select();
  }, []);

  const finish = (value: string | undefined) => {
    if (settled.current) {
      return;
    }
    settled.current = true;
    const title = value?.trim();
    onDone(
      title === undefined || title.length === 0 || title === initial
        ? undefined
        : title,
    );
  };

  return (
    <TextInput
      ref={input}
      className="min-w-0 flex-1 px-1.5 py-1"
      size="xs"
      radius="md"
      defaultValue={initial}
      maxLength={SESSION_TITLE_MAX_LENGTH}
      autoFocus
      aria-label={t("sessions.titleLabel")}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(undefined);
        }
      }}
      onBlur={(event) => {
        finish(event.currentTarget.value);
      }}
    />
  );
}

export const SessionRow = memo(SessionRowComponent);
