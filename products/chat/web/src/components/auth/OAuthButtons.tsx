import { oauthStartPath } from "@chat/queries/auth/path";
import { Button, Divider, Loader } from "@mantine/core";
import {
  IconBrandGithubFilled,
  IconBrandGoogleFilled,
} from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { chatEndpoint } from "~/lib/http";

interface Provider {
  readonly id: "google" | "github";
  readonly icon: ReactNode;
}

const PROVIDERS: readonly Provider[] = [
  { id: "google", icon: <IconBrandGoogleFilled size={16} /> },
  { id: "github", icon: <IconBrandGithubFilled size={16} /> },
];

/**
 * Guard: real anchors, and the click is never intercepted. The start route
 * answers 302 to the provider, and neither `fetch` nor a router navigation can
 * hand a cross-origin redirect to the address bar.
 */
export function OAuthButtons() {
  const { t } = useTranslation();
  const [leaving, setLeaving] = useState<Provider["id"] | undefined>(undefined);

  return (
    <div className="mt-7">
      <Divider label={t("auth.oauth.or")} labelPosition="center" />
      <div
        role="group"
        aria-label={t("auth.oauth.groupLabel")}
        aria-busy={leaving !== undefined}
        className={`mt-5 flex flex-col gap-2 ${
          leaving === undefined
            ? ""
            : "pointer-events-none opacity-60 motion-safe:transition-opacity motion-safe:duration-150"
        }`}
      >
        {PROVIDERS.map((provider) => (
          <Button
            key={provider.id}
            component="a"
            /**
             * Guard: the browser-facing base, never the injected client's. That
             * one resolves to the render server's own api origin during ssr, and
             * an absolute cross-origin href here would set the oauth state cookie
             * on a host the callback never returns to — every sign-in would come
             * back `oauth_state_invalid`.
             */
            href={chatEndpoint(oauthStartPath(provider.id))}
            variant="default"
            size="md"
            radius="md"
            fullWidth
            leftSection={provider.icon}
            /**
             * Guard: the whole budget for acknowledging the click is the frame
             * before the browser tears this document down. Dimming the group is
             * what that frame can carry; a spinner that never finishes rendering
             * is not.
             */
            onClick={() => {
              setLeaving(provider.id);
            }}
          >
            {t(`auth.oauth.${provider.id}`)}
          </Button>
        ))}
      </div>
      {leaving === undefined ? null : (
        <p className="mt-3 flex items-center justify-center gap-2 text-xs text-ink-dim">
          <Loader size="xs" />
          {t("auth.oauth.redirecting", {
            provider: t(
              leaving === "google"
                ? "auth.oauth.providerGoogle"
                : "auth.oauth.providerGithub",
            ),
          })}
        </p>
      )}
    </div>
  );
}
