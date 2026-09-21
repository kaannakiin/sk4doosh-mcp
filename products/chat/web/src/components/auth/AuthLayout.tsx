import { PRODUCT_NAME } from "@chat/contracts/common/product";
import { Outlet, getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { BrandRule } from "~/components/BrandRule";
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
            {PRODUCT_NAME}
          </h1>
          <p className="mt-5 max-w-[26ch] font-serif text-[1.125rem] leading-relaxed text-ink-dim italic">
            {t("auth.brand.tagline")}
          </p>
          <BrandRule className="mt-8" />
        </div>

        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <ThemeSwitcher />
        </div>
      </section>

      <main className="flex flex-col justify-center border-hairline bg-panel px-6 py-10 lg:border-s lg:px-10">
        <div className="mx-auto flex w-full max-w-88 flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
