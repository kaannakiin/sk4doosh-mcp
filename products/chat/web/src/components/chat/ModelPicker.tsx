import type { AgentSelection, CodexModel } from "@chat/contracts/agent/model";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { useAgentCatalog } from "@chat/queries/agent/catalog";
import { useSetDefaultAgentSelection } from "@chat/queries/agent/mutations";
import { Button, Popover, SegmentedControl, Select, Text } from "@mantine/core";
import { IconChevronDown, IconCpu } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { asCompact } from "~/core/text/count";

export interface ModelPickerProps {
  readonly sessionId: SessionId;
  readonly locale: Locale;
  readonly value: AgentSelection | null;
  readonly onChange: (selection: AgentSelection) => void;
}

function effortFor(model: CodexModel | undefined, wanted: string | null) {
  if (model === undefined) {
    return wanted;
  }

  return model.efforts.some((option) => option.effort === wanted)
    ? wanted
    : model.defaultEffort;
}

export function ModelPicker({
  sessionId,
  locale,
  value,
  onChange,
}: ModelPickerProps) {
  const { t } = useTranslation();
  const catalog = useAgentCatalog(sessionId, locale);
  const setDefault = useSetDefaultAgentSelection(locale);

  const data = catalog.data;
  const current = value ?? data?.selection.effective ?? null;
  const codexModels = data?.codex.models ?? [];
  const model = codexModels.find((entry) => entry.id === current?.codexModel);
  const label = [model?.displayName ?? current?.codexModel, current?.effort]
    .filter(Boolean)
    .join(" · ");

  const change = (patch: Partial<AgentSelection>) => {
    const next: AgentSelection = {
      codexModel: current?.codexModel ?? null,
      effort: current?.effort ?? null,
      workerModel: current?.workerModel ?? null,
      ...patch,
    };
    const chosen = codexModels.find((entry) => entry.id === next.codexModel);
    onChange({ ...next, effort: effortFor(chosen, next.effort) });
  };

  return (
    <Popover position="top-start" width={320} shadow="md" withinPortal>
      <Popover.Target>
        <Button
          variant="subtle"
          size="compact-xs"
          color="gray"
          leftSection={<IconCpu size={13} />}
          rightSection={<IconChevronDown size={12} />}
          aria-label={t("agents.model.picker")}
        >
          {label === "" ? t("agents.model.picker") : label}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        {catalog.isError ? (
          <Text size="xs" c="red">
            {t("agents.model.unavailable")}
          </Text>
        ) : (
          <div className="flex flex-col gap-3">
            <Select
              size="xs"
              label={t("agents.model.codex")}
              value={current?.codexModel ?? null}
              data={codexModels.map((entry) => ({
                value: entry.id,
                label: entry.displayName,
              }))}
              allowDeselect={false}
              comboboxProps={{ withinPortal: false }}
              onChange={(id) => {
                if (id !== null) {
                  change({ codexModel: id });
                }
              }}
            />
            {model === undefined ? null : (
              <div className="flex flex-col gap-1">
                <Text size="xs" fw={500}>
                  {t("agents.model.effort")}
                </Text>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={current?.effort ?? model.defaultEffort}
                  data={model.efforts.map((option) => option.effort)}
                  onChange={(effort) => change({ effort })}
                />
              </div>
            )}
            <Select
              size="xs"
              label={t("agents.model.worker")}
              value={current?.workerModel ?? null}
              data={(data?.worker.models ?? []).map((entry) => ({
                value: entry.id,
                label: `${entry.id} · ${asCompact(entry.contextLength, locale)}`,
              }))}
              allowDeselect={false}
              comboboxProps={{ withinPortal: false }}
              onChange={(id) => {
                if (id !== null) {
                  change({ workerModel: id });
                }
              }}
            />
            <Button
              size="xs"
              variant="light"
              disabled={current === null}
              loading={setDefault.isPending}
              onClick={() => {
                if (current !== null) {
                  setDefault.mutate(current);
                }
              }}
            >
              {t("agents.model.setDefault")}
            </Button>
          </div>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
