import { isInlineMediaType } from "@chat/contracts/attachment/media-type";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { presignOptions } from "@chat/queries/attachments/presign";
import { useRemoveAttachment } from "@chat/queries/attachments/mutations";
import type { AttachedFile } from "@chat/queries/chat/attached-files";
import { useChatClient } from "@chat/queries/provider";
import { ActionIcon, Loader, UnstyledButton } from "@mantine/core";
import { IconChevronUp, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatBytes } from "../../lib/relative-time";
import { AttachmentGlyph } from "./attachment-icon";
import { AttachmentPreview } from "./AttachmentPreview";
import { AttachmentThumb } from "./AttachmentThumb";

/**
 * Guard: folding starts at one more than this, never at exactly this plus one.
 * Hiding a single chip behind a "+1" button costs a row and saves none.
 */
const COLLAPSED_COUNT = 3;

const CHIP =
  "group/chip inline-flex max-w-full items-center rounded-[10px] border border-hairline bg-raised";

export interface AttachmentStripProps {
  readonly sessionId: SessionId;
  readonly locale: Locale;
  readonly files: readonly AttachedFile[];
  /** Files still being stored, shown only where they can still be removed. */
  readonly pending?: readonly File[];
  /**
   * Guard: only the composer's strip may remove. The same strip renders inside a
   * sent turn, where the chips are the record of what was asked — deleting from
   * there would edit history the visitor cannot get back.
   */
  readonly removable?: boolean;
}

export function AttachmentStrip({
  sessionId,
  locale,
  files,
  pending = [],
  removable = false,
}: AttachmentStripProps) {
  const { t } = useTranslation();
  const client = useChatClient();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<AttachedFile | undefined>();
  const [showAll, setShowAll] = useState(false);

  /**
   * Guard: only the stored files fold. An upload in flight is transient and
   * showing it is the whole point of rendering it, so hiding it behind a counter
   * would leave the visitor watching nothing happen.
   */
  const foldable = files.length > COLLAPSED_COUNT + 1;
  const visible = foldable && !showAll ? files.slice(0, COLLAPSED_COUNT) : files;
  const hidden = files.length - visible.length;

  /**
   * Guard: the download is a same-tab navigation rather than `window.open`. The
   * url has to be signed first, and a popup opened after an await is far enough
   * from the click that browsers block it. The response carries
   * `Content-Disposition: attachment`, so the page is never actually left.
   */
  const download = async (file: AttachedFile) => {
    const signed = await queryClient.fetchQuery({
      ...presignOptions(client, {
        sessionId,
        attachmentId: file.id,
        disposition: "attachment",
        locale,
      }),
      /**
       * Guard: `staleTime` is forced to zero here, against the shared default.
       * A thumbnail wants a stable url so the browser keeps the bytes; a
       * download the visitor just clicked wants a live signature, because a
       * cached one may be seconds from lapsing.
       */
      staleTime: 0,
    });
    window.location.assign(signed.url);
  };

  return (
    <>
      <ul
        className="flex list-none flex-wrap gap-1.5"
        aria-label={t("attachments.title")}
      >
        {visible.map((file) => {
          const previewable = isInlineMediaType(file.mediaType);
          const action = previewable
            ? "attachments.preview"
            : "attachments.download";

          return (
            <li
              key={file.id}
              className={`${CHIP} ${removable ? "pe-0.5" : "pe-1.5"}`}
            >
              <UnstyledButton
                className="inline-flex min-w-0 cursor-pointer items-center gap-2 py-1.5 pe-1.5 ps-2 text-inherit"
                aria-label={t(action, { name: file.filename })}
                onClick={() => {
                  if (previewable) {
                    setPreview(file);
                  } else {
                    void download(file);
                  }
                }}
              >
                {previewable ? (
                  <AttachmentThumb
                    sessionId={sessionId}
                    locale={locale}
                    attachment={file}
                  />
                ) : (
                  <AttachmentGlyph mediaType={file.mediaType} />
                )}
                <span className="flex min-w-0 flex-col items-start leading-tight">
                  <span className="max-w-44 truncate text-xs">
                    {file.filename}
                  </span>
                  <span className="text-[0.6875rem] whitespace-nowrap text-ink-dim">
                    {formatBytes(file.bytes, locale)}
                  </span>
                </span>
              </UnstyledButton>

              {removable ? (
                <RemoveChip
                  sessionId={sessionId}
                  locale={locale}
                  file={file}
                />
              ) : null}
            </li>
          );
        })}

        {foldable ? (
          <li className={`${CHIP} pe-0.5`}>
            <UnstyledButton
              className="inline-flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-ink-dim hover:text-ink"
              aria-expanded={showAll}
              onClick={() => {
                setShowAll((open) => !open);
              }}
            >
              {showAll ? (
                <>
                  <IconChevronUp className="shrink-0" size={15} />
                  <span className="text-xs">{t("attachments.less")}</span>
                </>
              ) : (
                <span className="text-xs">
                  {t("attachments.more", { count: hidden })}
                </span>
              )}
            </UnstyledButton>
          </li>
        ) : null}

        {pending.map((file, index) => (
          <li
            key={`${String(index)}:${file.name}`}
            className={`${CHIP} gap-2 py-1.5 pe-2.5 ps-2 opacity-70`}
            aria-busy
          >
            <Loader size={15} color="var(--color-accent)" />
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="max-w-44 truncate text-xs">{file.name}</span>
              <span className="text-[0.6875rem] whitespace-nowrap text-ink-dim">
                {t("attachments.uploading")}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <AttachmentPreview
        sessionId={sessionId}
        locale={locale}
        attachment={preview}
        onClose={() => {
          setPreview(undefined);
        }}
      />
    </>
  );
}

/**
 * Guard: the mutation lives here rather than in the strip, so a turn's read-only
 * chips subscribe to nothing. Held one level up it would put a mutation observer
 * on every message that ever carried a file, and every upload anywhere would
 * re-render all of them.
 */
function RemoveChip({
  sessionId,
  locale,
  file,
}: Readonly<{
  sessionId: SessionId;
  locale: Locale;
  file: AttachedFile;
}>) {
  const { t } = useTranslation();
  const remove = useRemoveAttachment(sessionId, locale);

  return (
    <ActionIcon
      className="shrink-0 opacity-0 group-hover/chip:opacity-100 group-focus-within/chip:opacity-100"
      variant="subtle"
      color="gray"
      radius="xl"
      size="sm"
      aria-label={t("attachments.remove", { name: file.filename })}
      loading={remove.isPending}
      onClick={() => {
        remove.mutate(file.id);
      }}
    >
      <IconX size={13} />
    </ActionIcon>
  );
}
