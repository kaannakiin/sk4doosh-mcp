import type { SessionId } from "@chat/contracts/chat/session";
import type { UIMessage } from "ai";
import { IconArrowDown } from "@tabler/icons-react";
import { UnstyledButton } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { useStickToBottom } from "~/core/hooks/use-stick-to-bottom";
import { MessageBubble } from "./MessageBubble";
import type { ToolDecision } from "./parts/ToolPart";

export interface MessageListProps {
  readonly sessionId: SessionId;
  readonly messages: readonly UIMessage[];
  readonly streaming: boolean;
  readonly pending: boolean;
  readonly truncated: boolean;
  readonly onDecision: (decision: ToolDecision) => void;
}

export function MessageList({
  sessionId,
  messages,
  streaming,
  pending,
  truncated,
  onDecision,
}: MessageListProps) {
  const { t } = useTranslation();
  const { ref, pinned, scrollToBottom } = useStickToBottom(
    pending ? "pending" : messages,
  );
  /**
   * Guard: a turn with no parts is not drawn. Conversations stored before the
   * api stopped writing them still carry the empty assistant row a failed stream
   * left behind, and rendering it opens a blank gap between two questions.
   */
  const drawn = messages.filter((message) => message.parts.length > 0);
  const last = drawn.length - 1;

  return (
    <div className="relative min-h-0 flex-1">
      <div className="h-full overflow-y-auto overscroll-contain" ref={ref}>
        {/**
         * Guard: the gap between turns is owned by this container, not by the
         * turns. A sibling rule keyed on the turn's own class only matches two
         * turns of the same role, so a question followed by an answer would sit
         * flush — the two carry different classes.
         */}
        <div className="mx-auto max-w-measure space-y-7 px-4 py-8">
          {truncated ? (
            <p className="border-s-2 border-hairline-strong py-2 ps-3 text-[0.8125rem] text-ink-dim">
              {t("conversation.truncated")}
            </p>
          ) : null}

          {drawn.map((message, index) => (
            <MessageBubble
              key={message.id}
              sessionId={sessionId}
              message={message}
              streaming={streaming && index === last}
              onDecision={onDecision}
            />
          ))}

          {pending ? (
            <p className="chat-thinking font-serif text-[1.0625rem] text-ink-dim italic">
              {t("conversation.thinking")}
            </p>
          ) : null}
        </div>
      </div>

      {pinned ? null : (
        <UnstyledButton
          className="absolute inset-x-0 bottom-4 mx-auto grid size-9 place-items-center rounded-full border border-hairline-strong bg-panel text-ink shadow-lg"
          aria-label={t("conversation.toBottom")}
          onClick={scrollToBottom}
        >
          <IconArrowDown size={16} />
        </UnstyledButton>
      )}
    </div>
  );
}
