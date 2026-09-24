import type { Locale } from "@chat/contracts/common/locale";
import type { IntegrationTool } from "@chat/contracts/integration/tool-approval";
import {
  toolOverrideSettingSchema,
  type ToolOverrideSetting,
} from "@chat/contracts/integration/tool-approval-mode";
import { useIntegrationTools } from "@chat/queries/connections/approvals";
import { useSetToolOverride } from "@chat/queries/connections/mutations";
import { Badge, Button, Loader, SegmentedControl } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface IntegrationToolListProps {
  readonly integrationId: string;
  readonly locale: Locale;
}

export function IntegrationToolList({
  integrationId,
  locale,
}: IntegrationToolListProps) {
  const { t } = useTranslation();
  const tools = useIntegrationTools(integrationId, locale, true);
  const setOverride = useSetToolOverride(locale);
  const [confirming, setConfirming] = useState<string | undefined>();

  if (tools.isPending) {
    return (
      <p className="flex items-center gap-2 px-1 py-2 text-xs text-ink-dim">
        <Loader size="xs" />
        {t("connections.toolList.loading")}
      </p>
    );
  }

  if (tools.data === undefined || tools.data.length === 0) {
    return (
      <p className="px-1 py-2 text-xs text-ink-dim">
        {t("connections.toolList.empty")}
      </p>
    );
  }

  /**
   * Guard: letting a destructive tool run unasked takes a second click. It is
   * the one setting on this page that lets a server's deleting tool act without
   * the reader seeing the call, so it is never a single misplaced tap.
   */
  const choose = (tool: IntegrationTool, mode: ToolOverrideSetting): void => {
    if (mode === "auto" && tool.destructive) {
      setConfirming(tool.exposedName);

      return;
    }

    setConfirming(undefined);
    setOverride.mutate({ exposedName: tool.exposedName, mode });
  };

  return (
    <ul className="w-full divide-y divide-hairline">
      {tools.data.map((tool) => (
        <li key={tool.exposedName} className="flex flex-col gap-1.5 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 grow truncate font-mono text-xs">
              {tool.title ?? tool.name}
            </span>
            {tool.destructive ? (
              <Badge size="xs" variant="light" color="var(--color-amber)">
                {t("connections.toolList.destructive")}
              </Badge>
            ) : null}
            {tool.overrideStale ? (
              <Badge size="xs" variant="light" color="var(--color-amber)">
                {t("connections.toolList.stale")}
              </Badge>
            ) : null}
            <SegmentedControl
              size="xs"
              radius="md"
              value={tool.override}
              disabled={setOverride.isPending}
              data={[
                {
                  value: "inherit",
                  label: t("connections.toolList.override.inherit"),
                },
                {
                  value: "always_ask",
                  label: t("connections.toolList.override.always_ask"),
                },
                {
                  value: "auto",
                  label: t("connections.toolList.override.auto"),
                },
              ]}
              onChange={(value) => {
                const parsed = toolOverrideSettingSchema.safeParse(value);
                if (parsed.success) {
                  choose(tool, parsed.data);
                }
              }}
            />
          </div>
          {confirming === tool.exposedName ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber px-2.5 py-2">
              <p className="grow text-xs">
                {t("connections.toolList.confirmAuto.message")}
              </p>
              <Button
                size="xs"
                radius="md"
                color="var(--color-amber)"
                onClick={() => {
                  setConfirming(undefined);
                  setOverride.mutate({
                    exposedName: tool.exposedName,
                    mode: "auto",
                  });
                }}
              >
                {t("connections.toolList.confirmAuto.confirm")}
              </Button>
              <Button
                size="xs"
                radius="md"
                variant="default"
                onClick={() => {
                  setConfirming(undefined);
                }}
              >
                {t("connections.toolList.confirmAuto.cancel")}
              </Button>
            </div>
          ) : null}
          {tool.destructive && tool.override === "auto" ? (
            <p className="text-xs text-amber">
              {t("connections.toolList.autoWarning")}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
