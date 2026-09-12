import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { DefaultChatTransport, type UIMessage } from "ai";

import type { ChatClient } from "../client.ts";

export interface ChatTransportParams {
  sessionId: SessionId;
  locale: Locale;
}

/**
 * Builds the AI SDK transport for one conversation.
 *
 * Guard: `headers` and `body` are passed as functions. The hook-level object
 * form is captured on the transport's first use and then goes stale, which is
 * how a session id from a previous conversation ends up on a later turn.
 *
 * Guard: `prepareSendMessagesRequest` is deliberately not set, so the default
 * body carries the whole history. The api reconciles a turn by treating the
 * posted history as authoritative and deleting the rows it omits — the SDK's
 * documented "send only the last message" optimization would erase the
 * conversation on its second turn.
 */
export function createChatTransport(
  client: ChatClient,
  { sessionId, locale }: ChatTransportParams,
): DefaultChatTransport<UIMessage> {
  return new DefaultChatTransport<UIMessage>({
    api: client.endpoint("/chat"),
    fetch: client.fetch,
    credentials: client.credentials,
    headers: () => ({ "x-locale": locale, ...client.authHeaders?.() }),
    body: () => ({ sessionId }),
  });
}
