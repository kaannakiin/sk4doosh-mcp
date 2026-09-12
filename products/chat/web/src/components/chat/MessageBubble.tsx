import type { SessionId } from "@chat/contracts/chat/session";
import { attachedFiles } from "@chat/queries/chat/attached-files";
import type { UIMessage } from "ai";
import {
  isDynamicToolUIPart,
  isFileUIPart,
  isReasoningUIPart,
  isToolUIPart,
} from "ai";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { useLocale } from "../../lib/use-locale";

import { AttachmentStrip } from "./AttachmentStrip";
import { FilePart } from "./parts/FilePart";
import { ReasoningPart } from "./parts/ReasoningPart";
import { TextPart } from "./parts/TextPart";
import { ToolPart } from "./parts/ToolPart";

export interface MessageBubbleProps {
  readonly sessionId: SessionId;
  readonly message: UIMessage;
  readonly streaming: boolean;
  readonly onDecision: (approvalId: string, approved: boolean) => void;
}

/**
 * Guard: the role is carried by typography, not by a coloured bubble. A question
 * is set in the interface sans inside a quiet card; an answer is set as serif
 * prose with no container, because an answer is the thing being read. The turn
 * is still announced to a screen reader through `aria-label`, which is why no
 * visible label is needed to tell them apart.
 */
function MessageBubbleComponent({
  sessionId,
  message,
  streaming,
  onDecision,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const asked = message.role === "user";
  const last = message.parts.length - 1;
  const files = attachedFiles(message);

  return (
    <article
      className={
        asked
          ? "chat-turn ms-auto max-w-[85%] rounded-[12px_12px_4px_12px] border border-hairline bg-raised px-4 py-3"
          : "chat-turn"
      }
      aria-label={asked ? t("conversation.you") : t("conversation.assistant")}
    >
      {files.length === 0 ? null : (
        <div className="mb-2">
          <AttachmentStrip
            sessionId={sessionId}
            locale={locale}
            files={files}
          />
        </div>
      )}

      {message.parts.map((part, index) => {
        const key = `${message.id}-${String(index)}`;

        if (part.type === "text") {
          return (
            <TextPart
              key={key}
              text={part.text}
              live={streaming && index === last}
              asked={asked}
            />
          );
        }

        if (isReasoningUIPart(part)) {
          return (
            <ReasoningPart
              key={key}
              text={part.text}
              streaming={part.state === "streaming"}
            />
          );
        }

        if (isToolUIPart(part) || isDynamicToolUIPart(part)) {
          return <ToolPart key={key} part={part} onDecision={onDecision} />;
        }

        if (isFileUIPart(part)) {
          return (
            <FilePart key={key} url={part.url} filename={part.filename} />
          );
        }

        return null;
      })}
    </article>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
