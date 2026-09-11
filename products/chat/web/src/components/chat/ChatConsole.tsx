import type { Attachment } from "@chat/contracts/attachment/attachment";
import type { Locale } from "@chat/contracts/common/locale";
import { Alert, Box, ScrollArea, Stack, Text } from "@mantine/core";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { chatEndpoint } from "../../lib/api";
import { AttachmentRail } from "./AttachmentRail";
import { Composer } from "./Composer";
import { MessageRow } from "./MessageRow";

/**
 * Guard: the UI batches stream updates instead of rendering every token. A
 * reader answer arrives as hundreds of deltas, and without this each one is a
 * render of the whole log.
 */
const STREAM_THROTTLE_MS = 50;

export interface ChatConsoleProps {
  readonly sessionId: string;
  readonly locale: Locale;
}

export function ChatConsole({ sessionId, locale }: ChatConsoleProps) {
  const { t } = useTranslation();
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: chatEndpoint("/chat"),
        headers: { "x-locale": locale },
        body: { sessionId },
      }),
    [locale, sessionId],
  );

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    addToolApprovalResponse,
  } = useChat({
    id: sessionId,
    transport,
    throttle: STREAM_THROTTLE_MS,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const onDecision = useCallback(
    (id: string, approved: boolean) => {
      void addToolApprovalResponse({ id, approved });
    },
    [addToolApprovalResponse],
  );

  const busy = status === "submitted" || status === "streaming";
  const lastId = messages.at(-1)?.id;

  return (
    <div className="chat-shell">
      <AttachmentRail
        sessionId={sessionId}
        locale={locale}
        onChange={setAttachments}
      />

      <Stack gap={0} style={{ minHeight: "100dvh" }}>
        <ScrollArea flex={1} type="auto">
          <Box px="lg" py="xl" maw="52rem">
            <Stack gap="lg">
              <Text size="sm" c="var(--chat-ink-dim)">
                {t("app.subtitle")}
              </Text>

              {messages.length === 0 ? (
                <Text size="sm" c="var(--chat-ink-dim)">
                  {t("conversation.empty")}
                </Text>
              ) : (
                <div className="chat-log">
                  {messages.map((message) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      streaming={
                        status === "streaming" && message.id === lastId
                      }
                      onDecision={onDecision}
                    />
                  ))}
                </div>
              )}

              {status === "submitted" ? (
                <Text className="chat-eyebrow">
                  {t("conversation.thinking")}
                </Text>
              ) : null}

              {error === undefined ? null : (
                <Alert color="red" variant="light">
                  {error.message}
                </Alert>
              )}
            </Stack>
          </Box>
        </ScrollArea>

        <Composer
          busy={busy}
          disabled={attachments.length === 0 && messages.length === 0}
          onSend={(text) => void sendMessage({ text })}
          onStop={stop}
        />
      </Stack>
    </div>
  );
}
