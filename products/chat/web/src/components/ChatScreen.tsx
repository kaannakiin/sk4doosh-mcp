import type { ChatMessage, Locale } from "@chat/contracts";
import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiRequestError, sendMessage } from "../lib/api";
import { LocaleSwitcher } from "./LocaleSwitcher";

export function ChatScreen() {
  const { locale } = useParams({ from: "/$locale/" });
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    setError(undefined);
    try {
      const result = await sendMessage(draft, locale as Locale);
      setMessages((current) => [...current, result.message, result.reply]);
      setDraft("");
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.payload.message
          : t("errors.network"),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Container size="sm" className="py-16">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Title order={1}>{t("app.title")}</Title>
            <Text c="dimmed" size="sm">
              {t("app.subtitle")}
            </Text>
          </Stack>
          <LocaleSwitcher current={locale as Locale} />
        </Group>

        <Stack gap="sm">
          {messages.length === 0 ? (
            <Text c="dimmed" size="sm">
              {t("conversation.empty")}
            </Text>
          ) : (
            messages.map((message) => (
              <Paper key={message.id} withBorder p="sm" radius="md">
                <Text size="xs" c="dimmed">
                  {message.role === "user"
                    ? t("conversation.you")
                    : t("conversation.assistant")}
                </Text>
                <Text>{message.content}</Text>
              </Paper>
            ))
          )}
        </Stack>

        {error ? <Alert color="red">{error}</Alert> : null}

        <Stack gap="xs">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder={t("composer.placeholder")}
            autosize
            minRows={2}
          />
          <Group justify="flex-end">
            <Button
              onClick={() => void submit()}
              loading={pending}
              disabled={draft.trim().length === 0}
              leftSection={<IconSend size={16} />}
            >
              {pending ? t("composer.sending") : t("composer.send")}
            </Button>
          </Group>
        </Stack>
      </Stack>
    </Container>
  );
}
