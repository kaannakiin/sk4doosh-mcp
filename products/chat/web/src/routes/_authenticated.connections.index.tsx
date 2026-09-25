import type { ConnectionOutcome } from "@chat/contracts/integration/connect";
import type { IntegrationOrigin } from "@chat/contracts/integration/integration";
import type { IntegrationSummary } from "@chat/contracts/integration/registration";
import {
  integrationListOptions,
  useIntegrationList,
} from "@chat/queries/connections/list";
import {
  useDisconnect,
  useRefreshTools,
  useRemoveIntegration,
} from "@chat/queries/connections/mutations";
import { Alert, Button, Skeleton } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { startTransition, useDeferredValue, useState } from "react";
import { useTranslation } from "react-i18next";

import { AddIntegrationModal } from "~/components/connections/AddIntegrationModal";
import { ConnectionsHeader } from "~/components/connections/ConnectionsHeader";
import {
  groupIntegrations,
  isIntegrationOrigin,
  isStatusGroup,
  tallyIntegrations,
  type IntegrationTally,
  type StatusGroup,
} from "~/components/connections/grouping";
import { IntegrationTable } from "~/components/connections/IntegrationTable";
import { IntegrationToolbar } from "~/components/connections/IntegrationToolbar";
import { RemoveIntegrationModal } from "~/components/connections/RemoveIntegrationModal";
import { useLocale } from "~/core/hooks/use-locale";
import { authTransport } from "~/lib/auth-transport";

interface ConnectionsSearch {
  readonly notice?: string;
  readonly q?: string;
  readonly status?: StatusGroup;
  readonly origin?: IntegrationOrigin;
}

export const Route = createFileRoute("/_authenticated/connections/")({
  /**
   * Guard: every parameter is optional rather than always present. A link into
   * this page from anywhere else carries no outcome and no filter, and a
   * required parameter would make every one of them name a value it has nothing
   * to say about.
   */
  validateSearch: (search: Record<string, unknown>): ConnectionsSearch => ({
    ...(typeof search.notice === "string" ? { notice: search.notice } : {}),
    ...(typeof search.q === "string" && search.q !== "" ? { q: search.q } : {}),
    ...(isStatusGroup(search.status) ? { status: search.status } : {}),
    ...(isIntegrationOrigin(search.origin) ? { origin: search.origin } : {}),
  }),
  loader: ({ context }) =>
    context.queryClient.prefetchQuery(
      integrationListOptions(authTransport(), context.locale),
    ),
  component: ConnectionsIndex,
});

const NOTICE_TONE: Record<ConnectionOutcome, "green" | "red"> = {
  connected: "green",
  attempt_invalid: "red",
  integration_unavailable: "red",
  access_denied: "red",
  provider_unavailable: "red",
  connection_failed: "red",
};

const NO_INTEGRATIONS: readonly IntegrationSummary[] = [];

function isOutcome(value: string): value is ConnectionOutcome {
  return Object.hasOwn(NOTICE_TONE, value);
}

function ConnectionsIndex() {
  const { t } = useTranslation();
  const locale = useLocale();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const list = useIntegrationList(locale);
  const disconnect = useDisconnect(locale);
  const remove = useRemoveIntegration(locale);
  const refresh = useRefreshTools(locale);

  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<IntegrationSummary | undefined>(
    undefined,
  );
  const [query, setQuery] = useState(search.q ?? "");
  const deferredQuery = useDeferredValue(query);

  const integrations = list.data ?? NO_INTEGRATIONS;
  const groups = groupIntegrations(integrations, {
    query: deferredQuery,
    status: search.status,
    origin: search.origin,
    locale,
  });
  const tally = tallyIntegrations(integrations);
  const busyIds = new Set(
    [disconnect, refresh, remove].flatMap((mutation) =>
      mutation.isPending && mutation.variables !== undefined
        ? [mutation.variables]
        : [],
    ),
  );

  const updateSearch = (patch: Partial<ConnectionsSearch>): void => {
    startTransition(() => {
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        replace: true,
      });
    });
  };

  const clearFilters = (): void => {
    setQuery("");
    updateSearch({ q: undefined, status: undefined, origin: undefined });
  };

  const notice =
    search.notice !== undefined && isOutcome(search.notice)
      ? search.notice
      : undefined;

  return (
    <>
      <ConnectionsHeader
        aside={
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {list.data === undefined ? null : <Tally tally={tally} />}
            <Button
              radius="md"
              leftSection={<IconPlus size={15} />}
              onClick={() => {
                setAdding(true);
              }}
            >
              {t("connections.add.open")}
            </Button>
          </div>
        }
      />

      {notice === undefined ? null : (
        <Alert
          className="mt-6"
          color={`var(--color-${NOTICE_TONE[notice]})`}
          variant="light"
          title={t(`connections.outcome.${notice}`)}
          withCloseButton
          onClose={() => {
            updateSearch({ notice: undefined });
          }}
        />
      )}

      {list.isPending ? (
        <div className="mt-8 flex flex-col gap-2" aria-busy>
          <Skeleton height={14} width="40%" radius="sm" />
          <Skeleton height={52} radius="md" />
          <Skeleton height={52} radius="md" />
          <Skeleton height={52} radius="md" />
        </div>
      ) : list.isError ? (
        <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-ink-dim">
          {t("connections.list.failed")}
          <Button
            size="xs"
            radius="md"
            variant="default"
            onClick={() => {
              void list.refetch();
            }}
          >
            {t("connections.list.retry")}
          </Button>
        </div>
      ) : integrations.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-hairline-strong px-6 py-14 text-center">
          <p className="font-serif text-xl">{t("connections.empty")}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-dim">
            {t("connections.emptyHint")}
          </p>
          <Button
            className="mt-6"
            radius="md"
            variant="default"
            leftSection={<IconPlus size={15} />}
            onClick={() => {
              setAdding(true);
            }}
          >
            {t("connections.add.open")}
          </Button>
        </div>
      ) : (
        <div className="mt-6">
          <IntegrationToolbar
            query={query}
            status={search.status}
            origin={search.origin}
            showOrigin={tally.origins > 1 || search.origin !== undefined}
            onQuery={(value) => {
              setQuery(value);
              updateSearch({ q: value === "" ? undefined : value });
            }}
            onStatus={(status) => {
              updateSearch({ status });
            }}
            onOrigin={(origin) => {
              updateSearch({ origin });
            }}
          />
          {groups.length === 0 ? (
            <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-ink-dim">
              {t("connections.filters.noResults")}
              <Button
                size="xs"
                radius="md"
                variant="subtle"
                onClick={clearFilters}
              >
                {t("connections.filters.clear")}
              </Button>
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <IntegrationTable
                groups={groups}
                busyIds={busyIds}
                locale={locale}
                onRefresh={refresh.mutate}
                onDisconnect={disconnect.mutate}
                onRemove={setRemoving}
              />
            </div>
          )}
        </div>
      )}

      <AddIntegrationModal
        opened={adding}
        locale={locale}
        onClose={() => {
          setAdding(false);
        }}
      />
      <RemoveIntegrationModal
        target={removing}
        pending={remove.isPending}
        onClose={() => {
          setRemoving(undefined);
        }}
        onConfirm={(target) => {
          setRemoving(undefined);
          remove.mutate(target.id);
        }}
      />
    </>
  );
}

function Tally({ tally }: Readonly<{ tally: IntegrationTally }>) {
  const { t } = useTranslation();

  return (
    <p className="font-mono text-xs text-ink-dim tabular-nums">
      {t("connections.summary.connected", { count: tally.connected })}
      {tally.attention > 0 ? (
        <>
          {" · "}
          <span className="text-amber">
            {t("connections.summary.attention", { count: tally.attention })}
          </span>
        </>
      ) : null}
      {" · "}
      {t("connections.tools.count", { count: tally.tools })}
    </p>
  );
}
