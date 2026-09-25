import type { IntegrationSummary } from "@chat/contracts/integration/registration";
import { Button, Modal } from "@mantine/core";
import { useTranslation } from "react-i18next";

interface RemoveIntegrationModalProps {
  readonly target: IntegrationSummary | undefined;
  readonly pending: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (integration: IntegrationSummary) => void;
}

export function RemoveIntegrationModal({
  target,
  pending,
  onClose,
  onConfirm,
}: RemoveIntegrationModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      opened={target !== undefined}
      onClose={onClose}
      title={t("connections.confirm.removeTitle")}
      centered
    >
      <p className="text-sm text-ink-dim">
        {t("connections.confirm.removeBody")}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="default" radius="md" onClick={onClose}>
          {t("connections.confirm.cancel")}
        </Button>
        <Button
          color="var(--color-red)"
          radius="md"
          loading={pending}
          onClick={() => {
            if (target !== undefined) {
              onConfirm(target);
            }
          }}
        >
          {t("connections.actions.remove")}
        </Button>
      </div>
    </Modal>
  );
}
