import type { Locale } from "@chat/contracts/common/locale";
import {
  createIntegrationSchema,
  type CreateIntegration,
} from "@chat/contracts/integration/registration";
import { integrationApprovalSettingSchema } from "@chat/contracts/integration/tool-approval-mode";
import { errorCodeOf } from "@chat/queries/client";
import { useAddIntegration } from "@chat/queries/connections/mutations";
import {
  Alert,
  Button,
  Modal,
  SegmentedControl,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { applyServerIssues } from "~/core/forms/apply-server-issues";
import { contractResolver } from "~/core/forms/contract-resolver";

interface AddIntegrationModalProps {
  readonly opened: boolean;
  readonly locale: Locale;
  readonly onClose: () => void;
}

export function AddIntegrationModal({
  opened,
  locale,
  onClose,
}: AddIntegrationModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("connections.add.title")}
      size="lg"
      centered
    >
      <AddIntegrationForm locale={locale} onAdded={onClose} />
    </Modal>
  );
}

function AddIntegrationForm({
  locale,
  onAdded,
}: Readonly<{ locale: Locale; onAdded: () => void }>) {
  const { t } = useTranslation();
  const add = useAddIntegration(locale);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const form = useForm<CreateIntegration>({
    resolver: contractResolver(createIntegrationSchema, t),
    defaultValues: { mcpUrl: "", approvalMode: "always_ask" },
    mode: "onTouched",
  });
  const { errors, isSubmitting } = form.formState;
  const approvalMode = useWatch({
    control: form.control,
    name: "approvalMode",
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);
    try {
      await add.mutateAsync(values);
      onAdded();
    } catch (error) {
      if (applyServerIssues(error, form.setError) === "form") {
        setFailure(errorCodeOf(error) ?? "integration_unreachable");
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate aria-busy={isSubmitting}>
      {failure === undefined ? null : (
        <Alert
          className="mb-4"
          color="var(--color-red)"
          variant="light"
          title={t(`connections.errors.${failure}`, {
            defaultValue: t("connections.errors.integration_unreachable"),
          })}
        />
      )}

      <TextInput
        {...form.register("mcpUrl")}
        data-autofocus
        size="md"
        radius="md"
        type="url"
        inputMode="url"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={t("connections.add.placeholder")}
        label={t("connections.add.label")}
        error={errors.mcpUrl?.message}
        classNames={{ input: "font-mono" }}
      />

      <div className="mt-4 flex flex-col gap-1.5">
        <span className="text-xs font-medium">{t("connections.add.mode")}</span>
        <SegmentedControl
          size="xs"
          radius="md"
          className="self-start"
          value={approvalMode}
          data={[
            {
              value: "always_ask",
              label: t("connections.integrationMode.always_ask"),
            },
            {
              value: "remember",
              label: t("connections.integrationMode.remember"),
            },
            { value: "auto", label: t("connections.integrationMode.auto") },
            {
              value: "inherit",
              label: t("connections.integrationMode.inherit"),
            },
          ]}
          onChange={(value) => {
            const parsed = integrationApprovalSettingSchema.safeParse(value);
            if (parsed.success) {
              form.setValue("approvalMode", parsed.data);
            }
          }}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-dim">{t("connections.add.hint")}</p>
        <Button
          type="submit"
          radius="md"
          loading={isSubmitting}
          disabled={isSubmitting}
        >
          {t("connections.add.submit")}
        </Button>
      </div>
    </form>
  );
}
