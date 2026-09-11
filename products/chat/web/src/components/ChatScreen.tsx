import type { Locale } from "@chat/contracts/common/locale";
import { ClientOnly, useParams } from "@tanstack/react-router";
import { useState } from "react";

import { resolveSessionId } from "../lib/session";
import { ChatConsole } from "./chat/ChatConsole";

/**
 * Guard: the session id lives in `sessionStorage`, which the server render
 * cannot read, and `useChat` keys its state on that id — so the console has to
 * mount once, on the client, already holding the final id. Rendering it on the
 * server with a generated id and swapping it afterwards resets the chat on the
 * first client render.
 */
export function ChatScreen() {
  const { locale } = useParams({ from: "/$locale/" });

  return (
    <ClientOnly>
      <MountedConsole locale={locale as Locale} />
    </ClientOnly>
  );
}

function MountedConsole({ locale }: Readonly<{ locale: Locale }>) {
  const [sessionId] = useState(resolveSessionId);

  return <ChatConsole sessionId={sessionId} locale={locale} />;
}
