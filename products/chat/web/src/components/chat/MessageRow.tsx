import { Anchor, Stack, Text } from "@mantine/core";
import type { UIMessage } from "ai";
import { isFileUIPart, isToolUIPart } from "ai";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { ToolCard } from "./ToolCard";

export interface MessageRowProps {
  readonly message: UIMessage;
  readonly streaming: boolean;
  readonly onDecision: (approvalId: string, approved: boolean) => void;
}

function MessageRowComponent({
  message,
  streaming,
  onDecision,
}: MessageRowProps) {
  const { t } = useTranslation();
  const lastIndex = message.parts.length - 1;

  return (
    <div className="chat-row">
      <Stack gap="xs">
        <Text className="chat-eyebrow">
          {message.role === "user"
            ? t("conversation.you")
            : t("conversation.assistant")}
        </Text>

        {message.parts.map((part, index) => {
          const key = `${message.id}-${String(index)}`;

          if (part.type === "text") {
            const live = streaming && index === lastIndex;

            return (
              <Text
                key={key}
                className={live ? "chat-said chat-cursor" : "chat-said"}
              >
                {part.text}
              </Text>
            );
          }

          if (isToolUIPart(part)) {
            return <ToolCard key={key} part={part} onDecision={onDecision} />;
          }

          if (isFileUIPart(part)) {
            return (
              <Anchor key={key} href={part.url} ff="monospace" size="sm">
                {part.filename ?? part.url}
              </Anchor>
            );
          }

          return null;
        })}
      </Stack>
    </div>
  );
}

export const MessageRow = memo(MessageRowComponent);
