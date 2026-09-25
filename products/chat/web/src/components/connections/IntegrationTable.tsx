import type { Locale } from "@chat/contracts/common/locale";
import { useTranslation } from "react-i18next";

import type { IntegrationGroup } from "./grouping";
import { IntegrationRow } from "./IntegrationRow";
import type { IntegrationActions } from "./IntegrationRowMenu";

const HEAD =
  "px-3 pb-2 text-[0.6875rem] font-normal tracking-wider text-ink-dim uppercase";

interface IntegrationTableProps extends IntegrationActions {
  readonly groups: readonly IntegrationGroup[];
  readonly busyIds: ReadonlySet<string>;
  readonly locale: Locale;
}

export function IntegrationTable({
  groups,
  busyIds,
  locale,
  onRefresh,
  onDisconnect,
  onRemove,
}: IntegrationTableProps) {
  const { t } = useTranslation();

  return (
    <table className="w-full table-auto border-collapse text-sm sm:table-fixed">
      <thead className="max-sm:hidden">
        <tr>
          <th scope="col" className={`${HEAD} ps-4 text-start max-sm:w-full`}>
            {t("connections.table.name")}
          </th>
          <th
            scope="col"
            className={`${HEAD} hidden w-48 text-start sm:table-cell`}
          >
            {t("connections.table.status")}
          </th>
          <th
            scope="col"
            className={`${HEAD} hidden w-16 text-end sm:table-cell`}
          >
            {t("connections.table.tools")}
          </th>
          <th
            scope="col"
            className={`${HEAD} hidden w-32 text-start md:table-cell`}
          >
            {t("connections.table.approval")}
          </th>
          <th
            scope="col"
            className={`${HEAD} hidden w-32 text-start md:table-cell`}
          >
            {t("connections.table.lastUsed")}
          </th>
          <th scope="col" className={`${HEAD} w-px sm:w-36`}>
            <span className="sr-only">{t("connections.table.actions")}</span>
          </th>
        </tr>
      </thead>
      {groups.map(({ group, integrations }) => (
        <tbody key={group}>
          <tr>
            <th
              scope="rowgroup"
              colSpan={6}
              className={`pt-7 pb-2 ps-4 text-start text-[0.6875rem] font-medium tracking-wider uppercase ${group === "attention" ? "text-amber" : "text-ink-dim"}`}
            >
              {t(`connections.groups.${group}`)}
              <span className="ms-2 font-mono font-normal tabular-nums opacity-70">
                {integrations.length}
              </span>
            </th>
          </tr>
          {integrations.map((integration) => (
            <IntegrationRow
              key={integration.id}
              integration={integration}
              busy={busyIds.has(integration.id)}
              locale={locale}
              onRefresh={onRefresh}
              onDisconnect={onDisconnect}
              onRemove={onRemove}
            />
          ))}
        </tbody>
      ))}
    </table>
  );
}
