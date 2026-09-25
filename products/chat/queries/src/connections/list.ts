import type { Locale } from "@chat/contracts/common/locale";
import {
  integrationListResponseSchema,
  type IntegrationSummary,
} from "@chat/contracts/integration/registration";
import { queryOptions, useQuery } from "@tanstack/react-query";

import type { ChatClient } from "../client.ts";
import { useChatClient } from "../provider.tsx";
import { connectionKeys } from "./keys.ts";
import { INTEGRATION_PATHS } from "./path.ts";

/**
 * Guard: `locale` is an argument and not part of the key, the same as every
 * other query here. It selects the language of the error copy the api returns,
 * not the rows, so keying on it would cache the same list twice and leave a
 * mutation's invalidation touching only one of them.
 */
export function integrationListOptions(client: ChatClient, locale: Locale) {
  return queryOptions({
    queryKey: connectionKeys.integrations(),
    queryFn: async ({ signal }): Promise<readonly IntegrationSummary[]> => {
      const { integrations } = await client.request(
        INTEGRATION_PATHS.root,
        integrationListResponseSchema,
        { locale, signal },
      );

      return integrations;
    },
  });
}

export function useIntegrationList(locale: Locale) {
  return useQuery(integrationListOptions(useChatClient(), locale));
}

export function useIntegration(integrationId: string, locale: Locale) {
  return useQuery({
    ...integrationListOptions(useChatClient(), locale),
    select: (integrations) =>
      integrations.find((integration) => integration.id === integrationId),
  });
}
