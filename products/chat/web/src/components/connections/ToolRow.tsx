import type { IntegrationTool } from "@chat/contracts/integration/tool-approval";
import {
  toolOverrideSettingSchema,
  type IntegrationApprovalSetting,
  type ToolApprovalMode,
  type ToolOverrideSetting,
} from "@chat/contracts/integration/tool-approval-mode";
import { toolPosture } from "@chat/contracts/tools/approval-decision";
import { Badge, Button, Checkbox, SegmentedControl } from "@mantine/core";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { EffectivePosture } from "./EffectivePosture";

export const TOOL_GRID =
  "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] lg:grid-cols-[auto_minmax(0,1fr)_13rem_auto]";

interface ToolRowProps {
  readonly tool: IntegrationTool;
  readonly integrationMode: IntegrationApprovalSetting;
  readonly readerMode: ToolApprovalMode | undefined;
  readonly selected: boolean;
  readonly confirming: boolean;
  readonly disabled: boolean;
  readonly onToggle: (name: string) => void;
  readonly onChoose: (tool: IntegrationTool, mode: ToolOverrideSetting) => void;
  readonly onConfirmAuto: (tool: IntegrationTool) => void;
  readonly onCancel: () => void;
}

/**
 * Guard: a list item on a grid, not a table row. `content-visibility: auto` is
 * what keeps a server with hundreds of tools cheap to render, and CSS
 * containment has no effect on internal table boxes — on a `<tr>` it is ignored.
 */
function ToolRowComponent({
  tool,
  integrationMode,
  readerMode,
  selected,
  confirming,
  disabled,
  onToggle,
  onChoose,
  onConfirmAuto,
  onCancel,
}: ToolRowProps) {
  const { t } = useTranslation();
  const answer =
    readerMode === undefined
      ? undefined
      : toolPosture({
          override: tool.override,
          overrideStale: tool.overrideStale,
          destructive: tool.destructive,
          integrationMode,
          readerMode,
        });

  return (
    <li
      className={`${TOOL_GRID} gap-y-2 border-t border-hairline px-1 py-3 [contain-intrinsic-size:auto_4.5rem] [content-visibility:auto] data-selected:bg-accent-soft`}
      data-selected={selected ? "" : undefined}
    >
      <Checkbox
        size="xs"
        className="pt-0.5"
        checked={selected}
        aria-label={t("connections.toolList.select", { name: tool.name })}
        onChange={() => {
          onToggle(tool.name);
        }}
      />

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate font-mono text-[0.8125rem]">
            {tool.name}
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
        </div>
        {tool.title !== null && tool.title !== tool.name ? (
          <p className="mt-0.5 text-sm">{tool.title}</p>
        ) : null}
        {tool.description === null || tool.description === "" ? null : (
          <p
            className="mt-0.5 line-clamp-2 text-xs text-ink-dim"
            title={tool.description}
          >
            {tool.description}
          </p>
        )}
        {answer === undefined ? null : (
          <EffectivePosture
            className="mt-1.5 lg:hidden"
            answer={answer}
            destructive={tool.destructive}
          />
        )}
      </div>

      {answer === undefined ? (
        <span className="hidden lg:block" />
      ) : (
        <EffectivePosture
          className="hidden pt-1 lg:block"
          answer={answer}
          destructive={tool.destructive}
        />
      )}

      <SegmentedControl
        size="xs"
        radius="md"
        className="col-start-2 self-start justify-self-start sm:col-start-auto sm:justify-self-end"
        value={tool.override}
        disabled={disabled}
        aria-label={t("connections.toolList.overrideFor", { name: tool.name })}
        data={[
          {
            value: "inherit",
            label: t("connections.toolList.override.inherit"),
          },
          {
            value: "always_ask",
            label: t("connections.toolList.override.always_ask"),
          },
          { value: "auto", label: t("connections.toolList.override.auto") },
        ]}
        onChange={(value) => {
          const parsed = toolOverrideSettingSchema.safeParse(value);
          if (parsed.success) {
            onChoose(tool, parsed.data);
          }
        }}
      />

      {confirming ? (
        <div className="col-span-full flex flex-wrap items-center gap-2 rounded-md border border-amber px-2.5 py-2 sm:col-start-2">
          <p className="grow text-xs">
            {t("connections.toolList.confirmAuto.message")}
          </p>
          <Button
            size="xs"
            radius="md"
            color="var(--color-amber)"
            onClick={() => {
              onConfirmAuto(tool);
            }}
          >
            {t("connections.toolList.confirmAuto.confirm")}
          </Button>
          <Button size="xs" radius="md" variant="default" onClick={onCancel}>
            {t("connections.toolList.confirmAuto.cancel")}
          </Button>
        </div>
      ) : null}

      {tool.destructive && tool.override === "auto" ? (
        <p className="col-span-full text-xs text-amber sm:col-start-2">
          {t("connections.toolList.autoWarning")}
        </p>
      ) : null}
    </li>
  );
}

export const ToolRow = memo(ToolRowComponent);
