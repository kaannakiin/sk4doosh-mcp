import { isSessionId, type SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { useSessionDetail } from "@chat/queries/sessions/detail";
import { Loader } from "@mantine/core";
import { ClientOnly, createFileRoute, notFound } from "@tanstack/react-router";

import { ChatSurface } from "../components/chat/ChatSurface";
import { useLocale } from "../lib/use-locale";

export const Route = createFileRoute("/c/$sessionId")({
  beforeLoad: ({ params }) => {
    if (!isSessionId(params.sessionId)) {
      throw notFound();
    }
  },
  component: ChatRoute,
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
