import { Outlet, getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { LocaleSwitcher } from "~/components/LocaleSwitcher";
import { ThemeSwitcher } from "~/components/ThemeSwitcher";
import { useSessionRecovery } from "~/core/hooks/use-session-recovery";

const route = getRouteApi("/auth");

/**
 * Guard: the columns are the reverse of `AppShell`'s. The app puts the panel on
 * the left and the paper on the right; signing in happens on the same two
 * materials with the rail on the other side, so the reader arrives somewhere
 * recognisably part of the product rather than on a detached card.
 */
export function AuthLayout() {
  const { t } = useTranslation();
  useSessionRecovery(route.useSearch().next);

  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_27rem]">
      <section className="flex flex-col justify-between gap-10 border-b border-hairline px-6 py-10 lg:border-b-0 lg:px-14 lg:py-14">
        <div className="flex flex-col">
          <h1 className="font-serif text-[clamp(2.5rem,5.5vw,4rem)] leading-[1.02] font-medium tracking-[-0.015em] text-ink">
            {t("app.title")}
          </h1>
          <p className="mt-5 max-w-[26ch] font-serif text-[1.125rem] leading-relaxed text-ink-dim italic">
            {t("auth.brand.tagline")}
          </p>
          <div className="mt-8 flex items-center gap-2" aria-hidden>
            <span className="h-0.5 w-10 rounded-sm bg-accent" />
            <span className="h-px w-16 bg-hairline-strong" />
            <span className="h-px w-24 bg-hairline" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <ThemeSwitcher />
        </div>
      </section>

      <main className="flex flex-col justify-center border-hairline bg-panel px-6 py-10 lg:border-s lg:px-10">
        <div className="mx-auto flex w-full max-w-[22rem] flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
