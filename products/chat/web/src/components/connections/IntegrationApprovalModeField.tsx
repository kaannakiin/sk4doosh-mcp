import type { Locale } from "@chat/contracts/common/locale";
import {
  integrationApprovalSettingSchema,
  type IntegrationApprovalSetting,
} from "@chat/contracts/integration/tool-approval-mode";
import { useSetIntegrationApprovalMode } from "@chat/queries/connections/mutations";
import { SegmentedControl } from "@mantine/core";
import { useTranslation } from "react-i18next";

interface IntegrationApprovalModeFieldProps {
  readonly integrationId: string;
  readonly mode: IntegrationApprovalSetting;
  readonly locale: Locale;
}

export function IntegrationApprovalModeField({
  integrationId,
  mode,
  locale,
}: IntegrationApprovalModeFieldProps) {
  const { t } = useTranslation();
  const setMode = useSetIntegrationApprovalMode(locale);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-xs font-medium">
          {t("connections.integrationMode.label")}
        </span>
        <SegmentedControl
          size="xs"
          radius="md"
          value={mode}
          disabled={setMode.isPending}
          data={[
            {
              value: "inherit",
              label: t("connections.integrationMode.inherit"),
            },
            {
              value: "always_ask",
              label: t("connections.integrationMode.always_ask"),
            },
            {
              value: "remember",
              label: t("connections.integrationMode.remember"),
            },
            { value: "auto", label: t("connections.integrationMode.auto") },
          ]}
          onChange={(value) => {
            const parsed = integrationApprovalSettingSchema.safeParse(value);
            if (parsed.success) {
              setMode.mutate({ integrationId, mode: parsed.data });
            }
          }}
        />
      </div>
      <p className="text-xs text-ink-dim">
        {mode === "inherit"
          ? t("connections.integrationMode.hint.inherit")
          : mode === "always_ask"
            ? t("connections.integrationMode.hint.always_ask")
            : mode === "remember"
              ? t("connections.integrationMode.hint.remember")
              : t("connections.integrationMode.hint.auto")}
      </p>
    </div>
  );
}
