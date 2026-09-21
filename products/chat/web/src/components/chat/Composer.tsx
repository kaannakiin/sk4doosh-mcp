import { SUPPORTED_MEDIA_TYPES } from "@chat/contracts/attachment/media-type";
import { ActionIcon, Tooltip, UnstyledButton } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import {
  IconArrowUp,
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconPaperclip,
  IconPlayerStopFilled,
} from "@tabler/icons-react";
import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { useTextareaAutosize } from "~/core/hooks/use-textarea-autosize";

export interface ComposerProps {
  readonly busy: boolean;
  /** Whether the strip inside the box is showing anything. */
  readonly attached: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  readonly onDrop: (files: readonly File[]) => void;
  readonly children: ReactNode;
}

export function Composer({
  busy,
  attached,
  onSend,
  onStop,
  onDrop,
  children,
}: ComposerProps) {
  const { t } = useTranslation();
  const [empty, setEmpty] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const openPicker = useRef<() => void>(null);
  const {
    ref: input,
    multiline,
    overflowing,
    measure,
    clear,
  } = useTextareaAutosize(expanded);

  /**
   * Guard: the textarea is uncontrolled and only `empty` reaches state, so
   * holding a key down re-renders this subtree once — when the send button
   * flips — instead of once per character against Mantine's dropzone, tooltip
   * and icon buttons. Submitting therefore empties the node through the hook and
   * re-measures by hand, because no state change will do it.
   */
  const submit = useCallback(() => {
    const node = input.current;
    if (node === null || busy) {
      return;
    }
    const text = node.value.trim();
    if (text.length === 0) {
      return;
    }
    onSend(text);
    clear();
    setEmpty(true);
    setExpanded(false);
  }, [busy, onSend, input, clear]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  /**
   * Guard: an attachment grows the box as surely as a second line does, and the
   * pill radius is only correct while the box is one row tall. Keyed on the
   * textarea alone, a chip left a 92px box carrying a 999px radius — a stadium
   * whose curve swallowed the buttons at both ends.
   *
   * Guard: that radius is switched, never transitioned. The height is written in
   * pixels by the autosize hook and lands in a single frame, so an eased radius
   * spends its whole duration describing a box that no longer exists — the same
   * stadium, for 150ms, on every long paste.
   */
  const grown = multiline || attached;
  const showExpand = overflowing || expanded;

  return (
    <div
      className="group/composer mx-auto max-w-measure px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      data-grown={grown ? "" : undefined}
    >
      <Dropzone
        openRef={openPicker}
        onDrop={onDrop}
        activateOnClick={false}
        accept={[...SUPPORTED_MEDIA_TYPES]}
        classNames={{
          root: "relative rounded-full border border-hairline bg-panel px-2 py-1.5 transition-[border-color] duration-150 focus-within:border-hairline-strong group-data-grown/composer:rounded-[20px] group-data-grown/composer:px-2 group-data-grown/composer:pt-2.5 group-data-grown/composer:pb-2",
          inner: "pointer-events-auto flex w-full flex-col",
        }}
      >
        {children}

        <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1 [grid-template-areas:'attach_input_send'] group-data-grown/composer:grid-cols-[auto_minmax(0,1fr)] group-data-grown/composer:gap-y-1.5 group-data-grown/composer:[grid-template-areas:'input_input''attach_send']">
          <Tooltip label={t("attachments.add")} withArrow>
            <ActionIcon
              className="[grid-area:attach]"
              variant="subtle"
              color="gray"
              radius="xl"
              size="lg"
              aria-label={t("attachments.add")}
              onClick={() => openPicker.current?.()}
            >
              <IconPaperclip size={18} />
            </ActionIcon>
          </Tooltip>

          <textarea
            ref={input}
            className="min-h-6 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1.5 font-sans text-[0.9375rem] leading-normal text-inherit [grid-area:input] scrollbar-thin placeholder:text-ink-dim focus:outline-none group-data-grown/composer:pe-7"
            rows={1}
            placeholder={t("composer.placeholder")}
            aria-label={t("composer.placeholder")}
            onChange={(event) => {
              measure();
              setEmpty(event.currentTarget.value.trim().length === 0);
            }}
            onKeyDown={onKeyDown}
          />

          <div className="justify-self-end [grid-area:send]">
            {busy ? (
              <ActionIcon
                size="lg"
                radius="xl"
                variant="filled"
                color="gray"
                aria-label={t("composer.stop")}
                onClick={onStop}
              >
                <IconPlayerStopFilled size={14} />
              </ActionIcon>
            ) : (
              <ActionIcon
                size="lg"
                radius="xl"
                aria-label={t("composer.send")}
                disabled={empty}
                onClick={submit}
              >
                <IconArrowUp size={18} />
              </ActionIcon>
            )}
          </div>
        </div>

        {showExpand ? (
          <UnstyledButton
            className="absolute inset-e-2 top-2 grid size-6 place-items-center rounded-md bg-panel text-ink-dim hover:bg-raised hover:text-ink"
            aria-label={t(expanded ? "composer.collapse" : "composer.expand")}
            aria-expanded={expanded}
            onClick={() => {
              setExpanded((open) => !open);
            }}
          >
            {expanded ? (
              <IconArrowsDiagonalMinimize2 size={14} />
            ) : (
              <IconArrowsDiagonal size={14} />
            )}
          </UnstyledButton>
        ) : null}
      </Dropzone>

      <p className="mt-1.5 text-center text-[0.6875rem] tracking-wide text-ink-dim opacity-0 transition-opacity duration-150 group-focus-within/composer:opacity-100">
        {t("composer.hint")}
      </p>
    </div>
  );
}
