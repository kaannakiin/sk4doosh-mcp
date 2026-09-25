import type { Locale } from "@chat/contracts/common/locale";
import type { IntegrationSummary } from "@chat/contracts/integration/registration";
import type { IntegrationTool } from "@chat/contracts/integration/tool-approval";
import type {
  ToolApprovalMode,
  ToolOverrideSetting,
} from "@chat/contracts/integration/tool-approval-mode";
import { useIntegrationTools } from "@chat/queries/connections/approvals";
import {
  useSetToolOverride,
  useSetToolOverrides,
} from "@chat/queries/connections/mutations";
import { Button, Checkbox, SegmentedControl, Skeleton } from "@mantine/core";
import { useCallback, useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";

import { FilterStrip } from "./FilterStrip";
import { SearchField } from "./SearchField";
import { filterTools, isToolFilter, type ToolFilter } from "./tool-filter";
import { TOOL_GRID, ToolRow } from "./ToolRow";
import { ToolBulkBar } from "./ToolBulkBar";

const NO_TOOLS: readonly IntegrationTool[] = [];

interface ToolTableProps {
  readonly integration: IntegrationSummary;
  readonly readerMode: ToolApprovalMode | undefined;
  readonly locale: Locale;
  readonly query: string;
  readonly filter: ToolFilter;
  readonly onQuery: (query: string) => void;
  readonly onFilter: (filter: ToolFilter) => void;
}

export function ToolTable({
  integration,
  readerMode,
  locale,
  query,
  filter,
  onQuery,
  onFilter,
}: ToolTableProps) {
  const { t } = useTranslation();
  const tools = useIntegrationTools(integration.id, locale, true);
  const {
    mutate: overrideTool,
    isPending: overridePending,
    variables: overrideVariables,
  } = useSetToolOverride(locale);
  const bulk = useSetToolOverrides(locale);

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  const deferredQuery = useDeferredValue(query);

  const all = tools.data ?? NO_TOOLS;
  const shown = filterTools(all, deferredQuery, filter, locale);
  const selectedShown = shown.filter((tool) => selected.has(tool.name));
  const destructiveSelected = selectedShown.filter(
    (tool) => tool.destructive,
  ).length;
  const allShownSelected =
    shown.length > 0 && selectedShown.length === shown.length;

  const toggle = useCallback((name: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(name)) {
        next.add(name);
      }

      return next;
    });
  }, []);

  /**
   * Guard: letting a destructive tool run unasked takes a second click. It is
   * the one setting on this page that lets a server's deleting tool act without
   * the reader seeing the call, so it is never a single misplaced tap.
   */
  const choose = useCallback(
    (tool: IntegrationTool, mode: ToolOverrideSetting) => {
      if (mode === "auto" && tool.destructive) {
        setConfirming(tool.exposedName);

        return;
      }

      setConfirming(undefined);
      overrideTool({ exposedName: tool.exposedName, mode });
    },
    [overrideTool],
  );

  const confirmAuto = useCallback(
    (tool: IntegrationTool) => {
      setConfirming(undefined);
      overrideTool({ exposedName: tool.exposedName, mode: "auto" });
    },
    [overrideTool],
  );

  const cancel = useCallback(() => {
    setConfirming(undefined);
  }, []);

  const toggleAllShown = (): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const tool of shown) {
        if (allShownSelected) {
          next.delete(tool.name);
        } else {
          next.add(tool.name);
        }
      }

      return next;
    });
  };

  const applyBulk = (mode: ToolOverrideSetting): void => {
    bulk.mutate(
      {
        integrationId: integration.id,
        names: selectedShown.map((tool) => tool.name),
        mode,
      },
      {
        onSuccess: () => {
          setSelected(new Set());
        },
      },
    );
  };

  if (tools.isPending) {
    return (
      <div className="mt-3 flex flex-col gap-2" aria-busy>
        <Skeleton height={36} radius="md" />
        <Skeleton height={56} radius="md" />
        <Skeleton height={56} radius="md" />
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <p className="mt-3 text-sm text-ink-dim">
        {t("connections.toolList.empty")}
      </p>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField
          className="sm:max-w-xs sm:grow"
          value={query}
          label={t("connections.toolList.search.label")}
          placeholder={t("connections.toolList.search.placeholder")}
          onChange={onQuery}
        />
        <FilterStrip className="sm:ms-auto">
          <SegmentedControl
            size="xs"
            radius="md"
            aria-label={t("connections.toolList.filter.label")}
            value={filter}
            data={[
              { value: "all", label: t("connections.toolList.filter.all") },
              {
                value: "destructive",
                label: t("connections.toolList.filter.destructive"),
              },
              {
                value: "overridden",
                label: t("connections.toolList.filter.overridden"),
              },
              { value: "stale", label: t("connections.toolList.filter.stale") },
            ]}
            onChange={(value) => {
              onFilter(isToolFilter(value) ? value : "all");
            }}
          />
        </FilterStrip>
      </div>

      <div
        className={`${TOOL_GRID} mt-4 items-center px-1 pb-2 text-[0.6875rem] tracking-wider text-ink-dim uppercase`}
      >
        <Checkbox
          size="xs"
          checked={allShownSelected}
          indeterminate={selectedShown.length > 0 && !allShownSelected}
          disabled={shown.length === 0}
          aria-label={t("connections.toolList.selectAll")}
          onChange={toggleAllShown}
        />
        <span>
          {t("connections.toolList.columns.tool")}
          <span className="ms-2 font-mono tracking-normal normal-case tabular-nums">
            {shown.length === all.length
              ? all.length
              : t("connections.toolList.shownOf", {
                  shown: shown.length,
                  total: all.length,
                })}
          </span>
        </span>
        <span className="hidden lg:block">
          {t("connections.toolList.columns.posture")}
        </span>
        <span className="hidden text-end sm:block">
          {t("connections.toolList.columns.override")}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-hairline px-1 py-6 text-sm text-ink-dim">
          {t("connections.toolList.noResults")}
          <Button
            size="xs"
            radius="md"
            variant="subtle"
            onClick={() => {
              onQuery("");
              onFilter("all");
            }}
          >
            {t("connections.filters.clear")}
          </Button>
        </div>
      ) : (
        <ul className="border-b border-hairline">
          {shown.map((tool) => (
            <ToolRow
              key={tool.exposedName}
              tool={tool}
              integrationMode={integration.approvalMode}
              readerMode={readerMode}
              selected={selected.has(tool.name)}
              confirming={confirming === tool.exposedName}
              disabled={
                bulk.isPending ||
                (overridePending &&
                  overrideVariables?.exposedName === tool.exposedName)
              }
              onToggle={toggle}
              onChoose={choose}
              onConfirmAuto={confirmAuto}
              onCancel={cancel}
            />
          ))}
        </ul>
      )}

      {selectedShown.length === 0 ? null : (
        <ToolBulkBar
          count={selectedShown.length}
          destructiveCount={destructiveSelected}
          pending={bulk.isPending}
          onApply={applyBulk}
          onClear={() => {
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
