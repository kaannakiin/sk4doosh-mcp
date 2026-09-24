import type { ConnectionOutcome } from "@chat/contracts/integration/connect";
import {
  createIntegrationSchema,
  type CreateIntegration,
  type IntegrationSummary,
} from "@chat/contracts/integration/registration";
import { integrationApprovalSettingSchema } from "@chat/contracts/integration/tool-approval-mode";
import { errorCodeOf } from "@chat/queries/client";
import { useCurrentUser } from "@chat/queries/auth/current-user";
import { useIntegrationList } from "@chat/queries/connections/list";
import {
  useAddIntegration,
  useDisconnect,
  useRefreshTools,
  useRemoveIntegration,
} from "@chat/queries/connections/mutations";
import { connectHref } from "@chat/queries/connections/path";
import {
  Alert,
  Button,
  Loader,
  Modal,
  SegmentedControl,
  TextInput,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { ApprovalModeField } from "~/components/connections/ApprovalModeField";
import { ChatToolApprovalList } from "~/components/connections/ChatToolApprovalList";
import { GrantTtlField } from "~/components/connections/GrantTtlField";
import { IntegrationCard } from "~/components/connections/IntegrationCard";
import { applyServerIssues } from "~/core/forms/apply-server-issues";
import { contractResolver } from "~/core/forms/contract-resolver";
import { useLocale } from "~/core/hooks/use-locale";
import { authTransport } from "~/lib/auth-transport";

export const Route = createFileRoute("/_authenticated/connections")({
  /**
   * Guard: `notice` is declared optional rather than always present. A link into
   * this page from anywhere else carries no outcome, and a required parameter
   * would make every one of them name a value it has nothing to say about.
   */
  validateSearch: (search: Record<string, unknown>): { notice?: string } =>
    typeof search.notice === "string" ? { notice: search.notice } : {},
  component: ConnectionsRoute,
});

const NOTICE_TONE: Record<ConnectionOutcome, "green" | "red"> = {
  connected: "green",
  attempt_invalid: "red",
  integration_unavailable: "red",
  access_denied: "red",
  provider_unavailable: "red",
  connection_failed: "red",
};

function isOutcome(value: string): value is ConnectionOutcome {
  return Object.hasOwn(NOTICE_TONE, value);
}

function ConnectionsRoute() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { notice } = Route.useSearch();
  const me = useCurrentUser(locale);
  const list = useIntegrationList(locale);
  const add = useAddIntegration(locale);
  const disconnect = useDisconnect(locale);
  const remove = useRemoveIntegration(locale);
  const refresh = useRefreshTools(locale);

  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [removing, setRemoving] = useState<IntegrationSummary | undefined>(
    undefined,
  );

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
      form.reset({ mcpUrl: "", approvalMode: "always_ask" });
    } catch (error) {
      if (applyServerIssues(error, form.setError) === "form") {
        setFailure(errorCodeOf(error) ?? "integration_unreachable");
      }
    }
  });

  /**
   * Guard: a full page assignment, not a router navigation. The api answers this
   * url with a `302` to the authorization server, which is a different origin —
   * the router would try to resolve it as an internal route and go nowhere.
   */
  const connect = (integration: IntegrationSummary): void => {
    window.location.assign(connectHref(authTransport(), integration.id));
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-xl font-medium">{t("connections.title")}</h1>
      <p className="mt-1 text-sm text-ink-dim">{t("connections.subtitle")}</p>

      {me.data === undefined || me.data === null ? null : (
        <div className="mt-6 flex flex-col gap-4 rounded-lg border border-hairline px-4 py-3">
          <ApprovalModeField mode={me.data.toolApprovalMode} locale={locale} />
          <GrantTtlField ttl={me.data.grantTtl} locale={locale} />
        </div>
      )}

      <section className="mt-6 rounded-lg border border-hairline px-4 py-3">
        <h2 className="text-sm font-medium">
          {t("connections.approvals.chatTitle")}
        </h2>
        <ChatToolApprovalList locale={locale} />
      </section>

      {notice !== undefined && isOutcome(notice) ? (
        <Alert
          className="mt-6"
          color={`var(--color-${NOTICE_TONE[notice]})`}
          variant="light"
          title={t(`connections.outcome.${notice}`)}
        />
      ) : null}

      {failure === undefined ? null : (
        <Alert
          className="mt-6"
          color="var(--color-red)"
          variant="light"
          title={t(`connections.errors.${failure}`, {
            defaultValue: t("connections.errors.integration_unreachable"),
          })}
        />
      )}

      <form
        onSubmit={submit}
        noValidate
        aria-busy={isSubmitting}
        className="mt-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <TextInput
            {...form.register("mcpUrl")}
            className="grow"
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
          />
          <Button
            type="submit"
            size="md"
            radius="md"
            className="sm:mt-[1.65rem]"
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            {t("connections.add.submit")}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs font-medium">
            {t("connections.add.mode")}
          </span>
          <SegmentedControl
            size="xs"
            radius="md"
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
        <p className="mt-2 text-xs text-ink-dim">{t("connections.add.hint")}</p>
      </form>

      <div className="mt-8 flex flex-col gap-3">
        {list.isPending ? <Loader size="sm" /> : null}
        {list.data?.length === 0 ? (
          <p className="text-sm text-ink-dim">{t("connections.empty")}</p>
        ) : null}
        {list.data?.map((integration) => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            busy={disconnect.isPending || remove.isPending || refresh.isPending}
            locale={locale}
            expanded={expanded === integration.id}
            onToggleApprovals={() => {
              setExpanded((open) =>
                open === integration.id ? undefined : integration.id,
              );
            }}
            onConnect={() => {
              connect(integration);
            }}
            onDisconnect={() => {
              void disconnect.mutateAsync(integration.id);
            }}
            onRefresh={() => {
              void refresh.mutateAsync(integration.id);
            }}
            onRemove={() => {
              setRemoving(integration);
            }}
          />
        ))}
      </div>

      <Modal
        opened={removing !== undefined}
        onClose={() => {
          setRemoving(undefined);
        }}
        title={t("connections.confirm.removeTitle")}
        centered
      >
        <p className="text-sm text-ink-dim">
          {t("connections.confirm.removeBody")}
        </p>
        <Button
          color="var(--color-red)"
          radius="md"
          className="mt-4"
          loading={remove.isPending}
          onClick={() => {
            const target = removing;
            setRemoving(undefined);
            if (target !== undefined) {
              void remove.mutateAsync(target.id);
            }
          }}
        >
          {t("connections.actions.remove")}
        </Button>
      </Modal>
    </div>
  );
}
