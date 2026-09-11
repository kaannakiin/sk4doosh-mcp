import type { Attachment } from "@chat/contracts/attachment/attachment";
import type { Locale } from "@chat/contracts/common/locale";
import {
  ActionIcon,
  Alert,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { IconTrash, IconUpload } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiRequestError } from "../../lib/api";
import {
  listAttachments,
  removeAttachment,
  uploadAttachment,
} from "../../lib/attachments";
import { LocaleSwitcher } from "../LocaleSwitcher";

const ACCEPTED_EXTENSIONS = [".xlsx", ".xlsm", ".csv", ".xml"];

export interface AttachmentRailProps {
  readonly sessionId: string;
  readonly locale: Locale;
  readonly onChange: (attachments: Attachment[]) => void;
}

function kilobytes(bytes: number): string {
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

export function AttachmentRail({
  sessionId,
  locale,
  onChange,
}: AttachmentRailProps) {
  const { t } = useTranslation();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const publish = useCallback(
    (next: Attachment[]) => {
      setAttachments(next);
      onChange(next);
    },
    [onChange],
  );

  useEffect(() => {
    let cancelled = false;
    void listAttachments(sessionId, locale)
      .then((next) => {
        if (!cancelled) {
          publish(next);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [sessionId, locale, publish]);

  const drop = async (files: File[]) => {
    setBusy(true);
    setError(undefined);
    try {
      for (const file of files) {
        const added = await uploadAttachment(sessionId, file, locale);
        setAttachments((current) => {
          const next = [...current, added];
          onChange(next);

          return next;
        });
      }
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.payload.message
          : t("errors.network"),
      );
    } finally {
      setBusy(false);
    }
  };

  const discard = async (attachmentId: string) => {
    try {
      publish(await removeAttachment(sessionId, attachmentId, locale));
    } catch {
      setError(t("errors.network"));
    }
  };

  return (
    <Stack className="chat-rail" gap="md" p="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={2}>
          <Title order={1} size="h4">
            {t("app.title")}
          </Title>
          <Text className="chat-eyebrow">
            {t("attachments.count", { count: attachments.length })}
          </Text>
        </Stack>
        <LocaleSwitcher current={locale} />
      </Group>

      <Dropzone
        onDrop={(files) => void drop(files)}
        accept={ACCEPTED_EXTENSIONS}
        loading={busy}
        multiple
      >
        <Stack gap={4} align="center" py="md">
          <IconUpload size={18} />
          <Text size="sm" ta="center">
            {t("attachments.drop")}
          </Text>
          <Text className="chat-eyebrow">{t("attachments.accept")}</Text>
        </Stack>
      </Dropzone>

      {error === undefined ? null : (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      <Stack gap={4}>
        <Text className="chat-eyebrow">{t("attachments.title")}</Text>
        {attachments.length === 0 ? (
          <Text size="sm" c="var(--chat-ink-dim)">
            {t("attachments.empty")}
          </Text>
        ) : (
          attachments.map((attachment) => (
            <Group
              key={attachment.id}
              justify="space-between"
              gap="xs"
              wrap="nowrap"
              style={{ borderTop: "1px solid var(--chat-hairline)" }}
              pt={6}
            >
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text size="sm" truncate>
                  {attachment.filename}
                </Text>
                <Text className="chat-eyebrow">
                  {kilobytes(attachment.bytes)}
                </Text>
              </Stack>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={t("attachments.remove")}
                onClick={() => void discard(attachment.id)}
              >
                <IconTrash size={15} />
              </ActionIcon>
            </Group>
          ))
        )}
        {busy ? <Loader size="xs" /> : null}
      </Stack>
    </Stack>
  );
}
