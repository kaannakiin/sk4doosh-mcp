import {
  agentCatalogResponseSchema,
  type AgentCatalogResponse,
} from "@chat/contracts/agent/model";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { queryOptions, useQuery } from "@tanstack/react-query";

import type { ChatClient } from "../client.ts";
import { useChatClient } from "../provider.tsx";
import { agentKeys } from "./keys.ts";
import { agentCatalogPath } from "./path.ts";

const CATALOG_STALE_TIME_MS = 60_000;

export function agentCatalogOptions(
  client: ChatClient,
  sessionId: SessionId | undefined,
  locale: Locale,
) {
  return queryOptions({
    queryKey: agentKeys.catalog(sessionId),
    staleTime: CATALOG_STALE_TIME_MS,
    queryFn: ({ signal }): Promise<AgentCatalogResponse> =>
      client.request(agentCatalogPath(sessionId), agentCatalogResponseSchema, {
        locale,
        signal,
      }),
  });
}

export function useAgentCatalog(
  sessionId: SessionId | undefined,
  locale: Locale,
) {
  return useQuery(agentCatalogOptions(useChatClient(), sessionId, locale));
}
