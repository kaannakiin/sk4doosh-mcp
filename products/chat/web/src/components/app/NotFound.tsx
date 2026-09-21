import { PRODUCT_NAME } from "@chat/contracts/common/product";
import { Link, useRouterState } from "@tanstack/react-router";
import { IconPencilPlus } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { BrandRule } from "~/components/BrandRule";

function NotFoundBody({
  title,
  body,
}: Readonly<{ title: string; body: string }>) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  /**
   * Guard: the heading takes focus on mount, via a ref rather than `autoFocus`.
   * A route change in a single page app moves nothing for a screen reader, so
   * without this the reader is left where they were while the content silently
   * changed. `autoFocus` will not do it — browsers honour that attribute on form
   * controls, not on a heading.
   */
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div>
      <p className="font-mono text-xs tracking-[0.18em] text-ink-dim">
        {t("notFound.code")}
      </p>

      <h1
        ref={heading}
        tabIndex={-1}
        className="mt-3 font-serif text-[clamp(1.75rem,5vw,2.5rem)] leading-[1.15] font-medium tracking-[-0.01em] text-ink outline-none"
      >
        {title}
      </h1>

      <p className="mt-5 rounded-lg border border-hairline bg-raised px-3 py-2 font-mono text-[0.8125rem] leading-relaxed break-all text-ink">
        <span className="sr-only">{t("notFound.address")}</span>
        {pathname}
      </p>

      <BrandRule className="mt-6" />

      <p className="mt-6 max-w-[46ch] text-sm leading-relaxed text-ink-dim">
        {body}
      </p>

      <Link
        to="/"
        className="mt-7 inline-flex items-center gap-2 rounded-lg border border-hairline bg-accent-soft px-3 py-2 text-[0.8125rem] text-ink no-underline hover:border-accent"
      >
        <IconPencilPlus size={15} />
        {t("notFound.start")}
      </Link>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="mx-auto w-full max-w-measure px-6 py-12">
        <div className="mb-10">
          <Link
            to="/"
            className="font-serif text-[1.0625rem] font-medium tracking-[0.01em] text-ink no-underline"
          >
            {PRODUCT_NAME}
          </Link>
        </div>

        <NotFoundBody title={t("notFound.title")} body={t("notFound.body")} />
      </div>
    </div>
  );
}

export function NotFoundPane() {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-0 flex-1 place-items-center">
      <div className="mx-auto w-full max-w-measure px-6 py-12">
        <NotFoundBody
          title={t("notFound.session.title")}
          body={t("notFound.session.body")}
        />
      </div>
    </div>
  );
}
