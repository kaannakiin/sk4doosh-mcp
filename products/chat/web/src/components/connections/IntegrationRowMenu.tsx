import type { IntegrationSummary } from "@chat/contracts/integration/registration";
import { ActionIcon, Menu } from "@mantine/core";
import {
  IconDots,
  IconPlugConnectedX,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

export interface IntegrationActions {
  readonly onRefresh: (integrationId: string) => void;
  readonly onDisconnect: (integrationId: string) => void;
  readonly onRemove: (integration: IntegrationSummary) => void;
}

interface IntegrationRowMenuProps extends IntegrationActions {
  readonly integration: IntegrationSummary;
  readonly busy: boolean;
}

export function IntegrationRowMenu({
  integration,
  busy,
  onRefresh,
  onDisconnect,
  onRemove,
}: IntegrationRowMenuProps) {
  const { t } = useTranslation();
  const connected =
    integration.authMode === "oauth" &&
    integration.connection?.status === "active";

  return (
    <Menu position="bottom-end" withinPortal shadow="sm">
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="md"
          loading={busy}
          aria-label={t("connections.table.actionsFor", {
            name: integration.displayName,
          })}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconRefresh size={14} />}
          onClick={() => {
            onRefresh(integration.id);
          }}
        >
          {t("connections.actions.refreshTools")}
        </Menu.Item>
        {connected ? (
          <Menu.Item
            leftSection={<IconPlugConnectedX size={14} />}
            onClick={() => {
              onDisconnect(integration.id);
            }}
          >
            {t("connections.actions.disconnect")}
          </Menu.Item>
        ) : null}
        {integration.origin === "user" ? (
          <>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={() => {
                onRemove(integration);
              }}
            >
              {t("connections.actions.remove")}
            </Menu.Item>
          </>
        ) : null}
      </Menu.Dropdown>
    </Menu>
  );
}
