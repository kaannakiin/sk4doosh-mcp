import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export interface AuthMethod {
  readonly to: "/auth/register" | "/auth/register/phone";
  readonly labelKey: string;
}

/**
 * Guard: links with `aria-current`, not buttons with `aria-pressed`. Each method
 * is its own url — which is what lets a password manager see one stable form,
 * keeps the back button working and makes the phone variant linkable — and a
 * navigation is not a toggle.
 */
export function AuthMethodSwitch({
  methods,
  current,
  label,
}: Readonly<{
  methods: readonly AuthMethod[];
  current: AuthMethod["to"];
  label: string;
}>) {
  const { t } = useTranslation();

  return (
    <nav aria-label={label} className="mt-6 flex items-center gap-0.5">
      {methods.map((method) => (
        <Link
          key={method.to}
          to={method.to}
          aria-current={method.to === current ? "page" : undefined}
          className="rounded-full px-3 py-1 text-sm text-ink-dim data-active:bg-raised data-active:text-ink"
          data-active={method.to === current ? "" : undefined}
        >
          {t(method.labelKey)}
        </Link>
      ))}
    </nav>
  );
}
