import type { Locale } from "@chat/contracts/common/locale";
import {
  isGrantTtl,
  type GrantTtl,
} from "@chat/contracts/integration/grant-scope";
import { useSetGrantTtl } from "@chat/queries/connections/mutations";
import { SegmentedControl } from "@mantine/core";
import { useTranslation } from "react-i18next";

interface GrantTtlFieldProps {
  readonly ttl: GrantTtl;
  readonly locale: Locale;
}

export function GrantTtlField({ ttl, locale }: GrantTtlFieldProps) {
  const { t } = useTranslation();
  const setTtl = useSetGrantTtl(locale);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-sm font-medium">{t("connections.ttl.label")}</span>
      <SegmentedControl
        size="xs"
        radius="md"
        value={ttl}
        disabled={setTtl.isPending}
        data={[
          { value: "day", label: t("connections.ttl.day") },
          { value: "week", label: t("connections.ttl.week") },
          { value: "never", label: t("connections.ttl.never") },
        ]}
        onChange={(value) => {
          if (isGrantTtl(value)) {
            setTtl.mutate(value);
          }
        }}
      />
      {/*
        Written as literal keys rather than a template, because check-i18n.mjs
        only verifies keys it can see; an interpolated one would go missing in
        one locale without failing lint.
      */}
      <p className="w-full text-xs text-ink-dim">
        {ttl === "day"
          ? t("connections.ttl.hint.day")
          : ttl === "week"
            ? t("connections.ttl.hint.week")
            : t("connections.ttl.hint.never")}
      </p>
    </div>
  );
}
