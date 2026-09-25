import { integrationIdSchema } from "@chat/contracts/integration/integration";
import type { IntegrationSummary } from "@chat/contracts/integration/registration";
import { useCurrentUser } from "@chat/queries/auth/current-user";
import { integrationToolsOptions } from "@chat/queries/connections/approvals";
import {
  integrationListOptions,
  useIntegration,
} from "@chat/queries/connections/list";
import {
  useDisconnect,
  useRefreshTools,
  useRemoveIntegration,
} from "@chat/queries/connections/mutations";
import { Skeleton } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { startTransition, useState } from "react";
import { useTranslation } from "react-i18next";

import { NotFoundPane } from "~/components/app/NotFound";
import { ApprovedToolList } from "~/components/connections/ApprovedToolList";
import { ConnectButton } from "~/components/connections/ConnectButton";
import { IntegrationApprovalModeField } from "~/components/connections/IntegrationApprovalModeField";
import { IntegrationRowMenu } from "~/components/connections/IntegrationRowMenu";
import { RemoveIntegrationModal } from "~/components/connections/RemoveIntegrationModal";
import { StatusMark } from "~/components/connections/StatusMark";
import {
  isToolFilter,
  type ToolFilter,
} from "~/components/connections/tool-filter";
import { ToolTable } from "~/components/connections/ToolTable";
import { useLocale } from "~/core/hooks/use-locale";
import { authTransport } from "~/lib/auth-transport";
import { formatRelative } from "~/lib/relative-time";

interface IntegrationSearch {
  readonly q?: string;
  readonly filter?: Exclude<ToolFilter, "all">;
}

const SECTION_TITLE =
  "text-[0.6875rem] font-medium tracking-wider text-ink-dim uppercase";

export const Route = createFileRoute(
  "/_authenticated/connections/$integrationId",
)({
  beforeLoad: ({ params }) => {
    if (!integrationIdSchema.safeParse(params.integrationId).success) {
      throw notFound();
    }
  },
  validateSearch: (search: Record<string, unknown>): IntegrationSearch => ({
    ...(typeof search.q === "string" && search.q !== "" ? { q: search.q } : {}),
    ...(isToolFilter(search.filter) && search.filter !== "all"
      ? { filter: search.filter }
      : {}),
  }),
  /**
   * Guard: the list and the tools are fetched side by side, and only a list that
   * did load is allowed to decide the page does not exist. A failed request is
   * left for the page to report; reading it as "no such integration" would tell
   * the reader their server is gone when the api was only unreachable.
   */
  loader: async ({ context, params }) => {
    const client = authTransport();
    const [integrations] = await Promise.all([
      context.queryClient
        .ensureQueryData(integrationListOptions(client, context.locale))
        .catch(() => undefined),
      context.queryClient.prefetchQuery(
        integrationToolsOptions(client, context.locale, params.integrationId),
      ),
    ]);

    if (
      integrations !== undefined &&
      !integrations.some(
        (integration) => integration.id === params.integrationId,
      )
    ) {
      throw notFound();
    }
  },
  component: IntegrationRoute,
  notFoundComponent: NotFoundPane,
});

function IntegrationRoute() {
  const { integrationId } = Route.useParams();
  const locale = useLocale();
  const integration = useIntegration(integrationId, locale);

  if (integration.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton height={12} width={120} radius="sm" />
        <Skeleton height={34} width="50%" radius="sm" />
        <Skeleton height={14} width="35%" radius="sm" />
        <Skeleton className="mt-6" height={88} radius="md" />
      </div>
    );
  }

  if (integration.data === undefined) {
    return <NotFoundPane />;
  }

  return <IntegrationPage integration={integration.data} />;
}

function IntegrationPage({
  integration,
}: Readonly<{ integration: IntegrationSummary }>) {
  const { t } = useTranslation();
  const locale = useLocale();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const me = useCurrentUser(locale);
  const disconnect = useDisconnect(locale);
  const refresh = useRefreshTools(locale);
  const remove = useRemoveIntegration(locale);

  const [removing, setRemoving] = useState<IntegrationSummary | undefined>(
    undefined,
  );
  const [query, setQuery] = useState(search.q ?? "");
  const lastUsed = integration.connection?.lastUsedAt ?? null;

  const updateSearch = (patch: Partial<IntegrationSearch>): void => {
    startTransition(() => {
      void navigate({
        search: (previous) => ({ ...previous, ...patch }),
        replace: true,
      });
    });
  };

  return (
    <>
      <Link
        to="/connections"
        className="inline-flex items-center gap-1.5 text-xs text-ink-dim no-underline transition-colors hover:text-ink"
      >
        <IconArrowLeft size={13} />
        {t("connections.detail.back")}
      </Link>

      <header className="mt-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-hairline pb-6">
        <div className="min-w-0">
          <h1 className="font-serif text-[clamp(1.625rem,4vw,2.125rem)] leading-tight font-medium tracking-[-0.01em] break-words">
            {integration.displayName}
          </h1>
          <p className="mt-1.5 font-mono text-xs break-all text-ink-dim">
            {integration.mcpUrl}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-dim">
            <StatusMark integration={integration} />
            <span className="font-mono tabular-nums">
              {t("connections.tools.count", { count: integration.toolCount })}
            </span>
            <span>{t(`connections.filters.origin.${integration.origin}`)}</span>
            <span>
              {lastUsed === null
                ? t("connections.detail.neverUsed")
                : t("connections.detail.lastUsed", {
                    when: formatRelative(lastUsed, locale),
                  })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConnectButton integration={integration} size="sm" />
          <IntegrationRowMenu
            integration={integration}
            busy={disconnect.isPending || refresh.isPending || remove.isPending}
            onRefresh={refresh.mutate}
            onDisconnect={disconnect.mutate}
            onRemove={setRemoving}
          />
        </div>
      </header>

      <section className="mt-8">
        <h2 className={SECTION_TITLE}>{t("connections.detail.approval")}</h2>
        <div className="mt-3 rounded-lg border border-hairline bg-panel px-4 py-4">
          <IntegrationApprovalModeField
            integrationId={integration.id}
            mode={integration.approvalMode}
            locale={locale}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className={SECTION_TITLE}>{t("connections.toolList.title")}</h2>
        <ToolTable
          integration={integration}
          readerMode={me.data?.toolApprovalMode}
          locale={locale}
          query={query}
          filter={search.filter ?? "all"}
          onQuery={(value) => {
            setQuery(value);
            updateSearch({ q: value === "" ? undefined : value });
          }}
          onFilter={(filter) => {
            updateSearch({ filter: filter === "all" ? undefined : filter });
          }}
        />
      </section>

      <section className="mt-10">
        <h2 className={SECTION_TITLE}>{t("connections.approvals.title")}</h2>
        <div className="mt-3 rounded-lg border border-hairline bg-panel px-4 py-1">
          <ApprovedToolList integrationId={integration.id} locale={locale} />
        </div>
      </section>

      <RemoveIntegrationModal
        target={removing}
        pending={remove.isPending}
        onClose={() => {
          setRemoving(undefined);
        }}
        onConfirm={(target) => {
          setRemoving(undefined);
          remove.mutate(target.id, {
            onSuccess: () => {
              void navigate({ to: "/connections" });
            },
          });
        }}
      />
    </>
  );
}
