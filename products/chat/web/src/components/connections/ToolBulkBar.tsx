import type { ToolOverrideSetting } from "@chat/contracts/integration/tool-approval-mode";
import { Button } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface ToolBulkBarProps {
  readonly count: number;
  readonly destructiveCount: number;
  readonly pending: boolean;
  readonly onApply: (mode: ToolOverrideSetting) => void;
  readonly onClear: () => void;
}

export function ToolBulkBar({
  count,
  destructiveCount,
  pending,
  onApply,
  onClear,
}: ToolBulkBarProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  /**
   * Guard: the same second click the single-tool control asks for, and it names
   * how many of the selection can change data. A bulk "don't ask" is the widest
   * trust this page can hand out in one gesture.
   */
  const choose = (mode: ToolOverrideSetting): void => {
    if (mode === "auto" && destructiveCount > 0) {
      setConfirming(true);

      return;
    }

    onApply(mode);
  };

  return (
    <div
      role="region"
      aria-label={t("connections.bulk.label")}
      className="sticky bottom-4 z-20 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-hairline-strong bg-panel px-3 py-2 shadow-[0_12px_32px_-16px_rgba(0,0,0,0.35)]"
    >
      {confirming ? (
        <>
          <p className="grow text-xs text-amber">
            {t("connections.bulk.confirmAuto", { count: destructiveCount })}
          </p>
          <Button
            size="xs"
            radius="md"
            color="var(--color-amber)"
            loading={pending}
            onClick={() => {
              setConfirming(false);
              onApply("auto");
            }}
          >
            {t("connections.toolList.confirmAuto.confirm")}
          </Button>
          <Button
            size="xs"
            radius="md"
            variant="default"
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t("connections.toolList.confirmAuto.cancel")}
          </Button>
        </>
      ) : (
        <>
          <span className="font-mono text-xs tabular-nums">
            {t("connections.bulk.selected", { count })}
          </span>
          <span className="text-xs text-ink-dim">
            {t("connections.bulk.apply")}
          </span>
          <Button.Group>
            <Button
              size="xs"
              variant="default"
              disabled={pending}
              onClick={() => {
                choose("inherit");
              }}
            >
              {t("connections.toolList.override.inherit")}
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={pending}
              onClick={() => {
                choose("always_ask");
              }}
            >
              {t("connections.toolList.override.always_ask")}
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={pending}
              onClick={() => {
                choose("auto");
              }}
            >
              {t("connections.toolList.override.auto")}
            </Button>
          </Button.Group>
          <Button
            size="xs"
            radius="md"
            variant="subtle"
            className="ms-auto"
            onClick={onClear}
          >
            {t("connections.bulk.clear")}
          </Button>
        </>
      )}
    </div>
  );
}
