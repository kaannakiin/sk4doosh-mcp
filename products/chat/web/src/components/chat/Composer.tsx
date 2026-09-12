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
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

/** Tallest the input grows before it scrolls and offers to expand. */
const COLLAPSED_MAX_PX = 168;

const EXPANDED_MAX_PX = 520;

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
  const [draft, setDraft] = useState("");
  const [multiline, setMultiline] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const openPicker = useRef<() => void>(null);
  const empty = draft.trim().length === 0;

  /**
   * Guard: the height is written straight to the node and only the two derived
   * booleans reach state, so typing re-renders this component when the shape
   * actually changes — crossing to a second line, or overflowing — rather than
   * on every keystroke. React bails out of a `setState` that lands on the same
   * value, so an ordinary keystroke schedules no render at all.
   *
   * Guard: the line count is derived from the computed line height rather than
   * compared against a pixel constant. A constant sits a pixel or two from the
   * real single-line height, so the box would flip to its tall shape by itself
   * the moment the webfont replaced the fallback, or the reader zoomed.
   *
   * Guard: a layout effect, not `onChange`, because `submit` clears the draft
   * through state. Measuring in the handler reads the outgoing text and leaves
   * the box tall after the message has gone.
   */
  useLayoutEffect(() => {
    const node = input.current;
    if (node === null) {
      return;
    }

    const ceiling = expanded ? EXPANDED_MAX_PX : COLLAPSED_MAX_PX;
    node.style.height = "auto";
    const content = node.scrollHeight;
    node.style.height = `${String(Math.min(content, ceiling))}px`;

    const styles = getComputedStyle(node);
    const lineHeight = Number.parseFloat(styles.lineHeight);
    const padding =
      Number.parseFloat(styles.paddingTop) +
      Number.parseFloat(styles.paddingBottom);

    setMultiline(
      Number.isFinite(lineHeight) &&
        lineHeight > 0 &&
        content - padding > lineHeight * 1.5,
    );
    setOverflowing(content > COLLAPSED_MAX_PX);
  }, [draft, expanded]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0 || busy) {
      return;
    }
    onSend(text);
    setDraft("");
    setExpanded(false);
  }, [draft, busy, onSend]);

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
          root: "relative rounded-full border border-hairline bg-panel px-2 py-1.5 transition-[border-radius,border-color] duration-150 focus-within:border-hairline-strong group-data-grown/composer:rounded-[20px] group-data-grown/composer:px-2 group-data-grown/composer:pt-2.5 group-data-grown/composer:pb-2",
          inner: "pointer-events-auto flex w-full flex-col gap-2",
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
            className="min-h-6 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1.5 font-sans text-[0.9375rem] leading-normal text-inherit [grid-area:input] [scrollbar-width:thin] placeholder:text-ink-dim focus:outline-none group-data-grown/composer:pe-7"
            rows={1}
            value={draft}
            placeholder={t("composer.placeholder")}
            aria-label={t("composer.placeholder")}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
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
