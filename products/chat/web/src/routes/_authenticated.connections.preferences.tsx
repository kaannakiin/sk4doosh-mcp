import { useCurrentUser } from "@chat/queries/auth/current-user";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { ApprovalModeField } from "~/components/connections/ApprovalModeField";
import { ChatToolApprovalList } from "~/components/connections/ChatToolApprovalList";
import { ChatToolCatalog } from "~/components/connections/ChatToolCatalog";
import { ConnectionsHeader } from "~/components/connections/ConnectionsHeader";
import { GrantTtlField } from "~/components/connections/GrantTtlField";
import { useLocale } from "~/core/hooks/use-locale";

export const Route = createFileRoute("/_authenticated/connections/preferences")(
  { component: PreferencesRoute },
);

function PreferencesRoute() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useCurrentUser(locale);

  return (
    <>
      <ConnectionsHeader />

      {me.data === undefined || me.data === null ? null : (
        <section className="mt-8">
          <h2 className="text-[0.6875rem] font-medium tracking-wider text-ink-dim uppercase">
            {t("connections.preferences.defaults")}
          </h2>
          <div className="mt-3 flex flex-col gap-5 rounded-lg border border-hairline bg-panel px-4 py-4">
            <ApprovalModeField
              mode={me.data.toolApprovalMode}
              locale={locale}
            />
            <GrantTtlField ttl={me.data.grantTtl} locale={locale} />
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-[0.6875rem] font-medium tracking-wider text-ink-dim uppercase">
          {t("connections.approvals.chatTitle")}
        </h2>
        <ChatToolCatalog
          readerMode={me.data?.toolApprovalMode}
          locale={locale}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-[0.6875rem] font-medium tracking-wider text-ink-dim uppercase">
          {t("connections.approvals.title")}
        </h2>
        <div className="mt-3 rounded-lg border border-hairline bg-panel px-4 py-2">
          <ChatToolApprovalList locale={locale} />
        </div>
      </section>
    </>
  );
}
