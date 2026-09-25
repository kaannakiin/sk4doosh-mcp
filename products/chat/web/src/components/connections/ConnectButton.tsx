import type { IntegrationSummary } from "@chat/contracts/integration/registration";
import { Button } from "@mantine/core";
import { useTranslation } from "react-i18next";

import { startConnect } from "./start-connect";

interface ConnectButtonProps {
  readonly integration: IntegrationSummary;
  readonly size?: "xs" | "sm";
}

/**
 * Guard: renders nothing for a server that asks for no credential, and nothing
 * for one already connected. An open server has no authorization server to send
 * the reader to, and a connect button there would start a flow against an
 * endpoint that does not exist.
 */
export function ConnectButton({
  integration,
  size = "xs",
}: ConnectButtonProps) {
  const { t } = useTranslation();
  const status = integration.connection?.status;

  if (integration.authMode === "none" || status === "active") {
    return null;
  }

  const reconnect = status === "reauth_required";

  return (
    <Button
      size={size}
      radius="md"
      variant={reconnect ? "light" : "default"}
      color={reconnect ? "var(--color-amber)" : undefined}
      className="relative z-10"
      onClick={() => {
        startConnect(integration.id);
      }}
    >
      {t(
        reconnect
          ? "connections.actions.reconnect"
          : "connections.actions.connect",
      )}
    </Button>
  );
}
