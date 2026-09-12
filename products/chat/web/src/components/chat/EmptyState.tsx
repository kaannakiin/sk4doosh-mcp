import { useTranslation } from "react-i18next";

export function EmptyState() {
  const { t } = useTranslation();

  return (
    <div className="grid min-h-0 flex-1 place-items-center">
      <div className="mx-auto max-w-measure px-4 py-8">
        <h1 className="font-serif text-[clamp(1.75rem,5vw,2.5rem)] leading-[1.15] font-medium tracking-[-0.01em]">
          {t("app.title")}
        </h1>
        <p className="mt-3 font-serif text-[1.0625rem] leading-relaxed text-ink-dim">
          {t("app.subtitle")}
        </p>
        <p className="mt-6 text-[0.8125rem] text-ink-dim">
          {t("conversation.empty")}
        </p>
      </div>
    </div>
  );
}
