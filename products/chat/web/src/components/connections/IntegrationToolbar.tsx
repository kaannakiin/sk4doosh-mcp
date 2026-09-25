import type { IntegrationOrigin } from "@chat/contracts/integration/integration";
import { SegmentedControl } from "@mantine/core";
import { useTranslation } from "react-i18next";

import {
  isIntegrationOrigin,
  isStatusGroup,
  type StatusGroup,
} from "./grouping";
import { SearchField } from "./SearchField";

interface IntegrationToolbarProps {
  readonly query: string;
  readonly status: StatusGroup | undefined;
  readonly origin: IntegrationOrigin | undefined;
  readonly showOrigin: boolean;
  readonly onQuery: (query: string) => void;
  readonly onStatus: (status: StatusGroup | undefined) => void;
  readonly onOrigin: (origin: IntegrationOrigin | undefined) => void;
}

export function IntegrationToolbar({
  query,
  status,
  origin,
  showOrigin,
  onQuery,
  onStatus,
  onOrigin,
}: IntegrationToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <SearchField
        className="lg:max-w-xs lg:grow"
        value={query}
        label={t("connections.search.label")}
        placeholder={t("connections.search.placeholder")}
        onChange={onQuery}
      />
      <div className="flex flex-wrap items-center gap-2 lg:ms-auto">
        <SegmentedControl
          size="xs"
          radius="md"
          aria-label={t("connections.filters.status.label")}
          value={status ?? "all"}
          data={[
            { value: "all", label: t("connections.filters.status.all") },
            {
              value: "attention",
              label: t("connections.filters.status.attention"),
            },
            {
              value: "connected",
              label: t("connections.filters.status.connected"),
            },
            {
              value: "disconnected",
              label: t("connections.filters.status.disconnected"),
            },
          ]}
          onChange={(value) => {
            onStatus(isStatusGroup(value) ? value : undefined);
          }}
        />
        {showOrigin ? (
          <SegmentedControl
            size="xs"
            radius="md"
            aria-label={t("connections.filters.origin.label")}
            value={origin ?? "all"}
            data={[
              { value: "all", label: t("connections.filters.origin.all") },
              {
                value: "partner",
                label: t("connections.filters.origin.partner"),
              },
              { value: "user", label: t("connections.filters.origin.user") },
            ]}
            onChange={(value) => {
              onOrigin(isIntegrationOrigin(value) ? value : undefined);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
