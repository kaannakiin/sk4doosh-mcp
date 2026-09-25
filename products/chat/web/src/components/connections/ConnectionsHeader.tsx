import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

const TAB =
  "-mb-px border-b-2 border-transparent pb-2.5 text-sm text-ink-dim no-underline transition-colors hover:text-ink data-[status=active]:border-accent data-[status=active]:text-ink";

interface ConnectionsHeaderProps {
  readonly aside?: ReactNode;
}

export function ConnectionsHeader({ aside }: ConnectionsHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-serif text-[clamp(1.625rem,4vw,2.125rem)] leading-tight font-medium tracking-[-0.01em]">
            {t("connections.title")}
          </h1>
          <p className="mt-1.5 text-sm text-ink-dim">
            {t("connections.subtitle")}
          </p>
        </div>
        {aside}
      </div>

      <nav
        aria-label={t("connections.tabs.label")}
        className="flex gap-6 border-b border-hairline"
      >
        <Link to="/connections" activeOptions={{ exact: true }} className={TAB}>
          {t("connections.tabs.integrations")}
        </Link>
        <Link to="/connections/preferences" className={TAB}>
          {t("connections.tabs.preferences")}
        </Link>
      </nav>
    </header>
  );
}
