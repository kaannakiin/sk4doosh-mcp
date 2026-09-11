import { ActionIcon, Group, Stack, Text, Textarea } from "@mantine/core";
import { IconPlayerStopFilled, IconSend } from "@tabler/icons-react";
import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

export interface ComposerProps {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
}

export function Composer({ busy, disabled, onSend, onStop }: ComposerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const empty = draft.trim().length === 0;

  const submit = () => {
    if (empty || busy) {
      return;
    }
    onSend(draft.trim());
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Stack
      gap={6}
      p="md"
      style={{
        borderTop: "1px solid var(--chat-hairline)",
        backgroundColor: "var(--chat-panel)",
      }}
    >
      <Group gap="sm" align="flex-end" wrap="nowrap">
        <Textarea
          flex={1}
          autosize
          minRows={1}
          maxRows={8}
          value={draft}
          disabled={disabled}
          placeholder={t("composer.placeholder")}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <ActionIcon
            size="lg"
            variant="default"
            aria-label={t("composer.stop")}
            onClick={onStop}
          >
            <IconPlayerStopFilled size={16} />
          </ActionIcon>
        ) : (
          <ActionIcon
            size="lg"
            aria-label={t("composer.send")}
            disabled={empty || disabled}
            onClick={submit}
          >
            <IconSend size={16} />
          </ActionIcon>
        )}
      </Group>
      <Text className="chat-eyebrow">{t("composer.hint")}</Text>
    </Stack>
  );
}
