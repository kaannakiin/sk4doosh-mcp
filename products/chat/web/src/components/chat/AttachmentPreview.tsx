import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import type { AttachedFile } from "@chat/queries/chat/attached-files";
import { usePresignedUrl } from "@chat/queries/attachments/presign";
import { Loader, Modal, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

export interface AttachmentPreviewProps {
  readonly sessionId: SessionId;
  readonly locale: Locale;
  readonly attachment: AttachedFile | undefined;
  readonly onClose: () => void;
}

/**
 * Shows an image attachment at full size.
 *
 * Guard: only image types reach here. The api grants an `inline` disposition
 * solely for an allow-listed image type and answers `not_previewable` otherwise,
 * so anything else is handed to the browser as a download by the caller instead.
 */
export function AttachmentPreview({
  sessionId,
  locale,
  attachment,
  onClose,
}: AttachmentPreviewProps) {
  const { t } = useTranslation();
  const presigned = usePresignedUrl({
    sessionId,
    attachmentId: attachment?.id ?? "",
    disposition: "inline",
    locale,
    enabled: attachment !== undefined,
  });

  return (
    <Modal
      opened={attachment !== undefined}
      onClose={onClose}
      size="auto"
      centered
      title={attachment?.filename}
    >
      {presigned.isPending ? <Loader size="sm" /> : null}
      {presigned.isError ? (
        <Text size="sm" c="var(--color-red)">
          {t("attachments.previewFailed")}
        </Text>
      ) : null}
      {presigned.data === undefined ? null : (
        <img
          className="max-h-[75dvh] max-w-[min(80vw,60rem)] rounded-lg"
          src={presigned.data.url}
          alt={attachment?.filename ?? ""}
        />
      )}
    </Modal>
  );
}
