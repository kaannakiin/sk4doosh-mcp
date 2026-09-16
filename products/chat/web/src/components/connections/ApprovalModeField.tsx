import type { Locale } from "@chat/contracts/common/locale";
import {
  isToolApprovalMode,
  type ToolApprovalMode,
} from "@chat/contracts/integration/tool-approval-mode";
import { useSetToolApprovalMode } from "@chat/queries/connections/mutations";
import { SegmentedControl } from "@mantine/core";
import { useTranslation } from "react-i18next";

interface ApprovalModeFieldProps {
  readonly mode: ToolApprovalMode;
  readonly locale: Locale;
}

export function ApprovalModeField({ mode, locale }: ApprovalModeFieldProps) {
  const { t } = useTranslation();
  const setMode = useSetToolApprovalMode(locale);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-sm font-medium">{t("connections.mode.label")}</span>
      <SegmentedControl
        size="xs"
        radius="md"
        value={mode}
        disabled={setMode.isPending}
        data={[
          { value: "remember", label: t("connections.mode.remember") },
          { value: "always_ask", label: t("connections.mode.always_ask") },
        ]}
        onChange={(value) => {
          if (isToolApprovalMode(value)) {
            setMode.mutate(value);
          }
        }}
      />
      {/*
        Written as literal keys rather than a template, because check-i18n.mjs
        only verifies keys it can see; an interpolated one would go missing in
        one locale without failing lint.
      */}
      <p className="w-full text-xs text-ink-dim">
        {mode === "remember"
          ? t("connections.mode.hint.remember")
          : t("connections.mode.hint.always_ask")}
      </p>
    </div>
  );
}
