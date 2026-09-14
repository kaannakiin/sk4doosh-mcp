/// <reference types="vite/client" />
import { ChatClientProvider } from "@chat/queries/provider";
import type { Locale } from "@chat/contracts/common/locale";
import {
  ColorSchemeScript,
  MantineProvider,
  mantineHtmlProps,
} from "@mantine/core";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { I18nextProvider } from "react-i18next";

import { AppShell } from "~/components/app/AppShell";
import { useI18nRuntime } from "~/core/hooks/use-i18n-runtime";
import { chatClient } from "~/lib/chat-client";
import { resolveLocale } from "~/lib/locale";
import appCss from "../styles/app.css?url";
import { theme } from "~/theme";

export interface RouterContext {
  queryClient: QueryClient;
}

const FONTS =
  "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..500&family=Public+Sans:ital,wght@0,400..700;1,400..600&family=IBM+Plex+Mono:wght@400;500&display=swap";

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async (): Promise<{ locale: Locale }> => ({
    locale: await resolveLocale(),
  }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: FONTS },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const { queryClient, locale } = Route.useRouteContext();
  const i18n = useI18nRuntime(locale);

  return (
    <html lang={locale} {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <ChatClientProvider client={chatClient}>
            <MantineProvider theme={theme} defaultColorScheme="auto">
              <I18nextProvider i18n={i18n}>
                <AppShell />
              </I18nextProvider>
            </MantineProvider>
          </ChatClientProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
