import { isSessionId, type SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { useSessionDetail } from "@chat/queries/sessions/detail";
import { useOpenSession } from "@chat/queries/sessions/mutations";
import { Loader } from "@mantine/core";
import { ClientOnly, createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect } from "react";

import { NotFoundPane } from "~/components/app/NotFound";
import { ChatSurface } from "~/components/chat/ChatSurface";
import { useLocale } from "~/core/hooks/use-locale";

export const Route = createFileRoute("/_authenticated/c/$sessionId")({
  beforeLoad: ({ params }) => {
    if (!isSessionId(params.sessionId)) {
      throw notFound();
    }
  },
  component: ChatRoute,
  notFoundComponent: NotFoundPane,
});

/**
 * Guard: the surface is client only. `useChat` builds its store from the history
 * on its first render, and a server render would build it from an empty list and
 * then keep that store on hydration.
 */
function ChatRoute() {
  const { sessionId } = Route.useParams();
  const locale = useLocale();

  return (
    <ClientOnly fallback={<Pending />}>
      <LoadedChat locale={locale} sessionId={sessionId} />
    </ClientOnly>
  );
}

function LoadedChat({
  locale,
  sessionId,
}: Readonly<{ locale: Locale; sessionId: SessionId }>) {
  const detail = useSessionDetail(sessionId, locale);
  const { mutate: open } = useOpenSession(locale);
  const persisted = detail.data?.fresh === false;

  /**
   * Guard: an open is recorded only for a conversation the api has stored. A
   * fresh id has no row yet, and its first turn bumps the order on its own.
   */
  useEffect(() => {
    if (persisted) {
      open(sessionId);
    }
  }, [persisted, sessionId, open]);

  if (detail.data === undefined) {
    return <Pending />;
  }

  return (
    <ChatSurface
      key={sessionId}
      sessionId={sessionId}
      locale={locale}
      view={detail.data}
    />
  );
}

function Pending() {
  return (
    <div className="grid flex-1 place-items-center">
      <Loader size="sm" />
    </div>
  );
}
