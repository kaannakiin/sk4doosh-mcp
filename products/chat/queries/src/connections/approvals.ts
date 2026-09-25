import type { Locale } from "@chat/contracts/common/locale";
import {
  approvedToolListResponseSchema,
  chatToolListResponseSchema,
  integrationToolListResponseSchema,
  type ApprovedTool,
  type ChatToolEntry,
  type IntegrationTool,
} from "@chat/contracts/integration/tool-approval";
import { queryOptions, useQuery } from "@tanstack/react-query";

import type { ChatClient } from "../client.ts";
import { useChatClient } from "../provider.tsx";
import { connectionKeys } from "./keys.ts";
import { INTEGRATION_PATHS, integrationPath } from "./path.ts";

export function integrationApprovalsOptions(
  client: ChatClient,
  locale: Locale,
  integrationId: string,
) {
  return queryOptions({
    queryKey: connectionKeys.approvals(integrationId),
    queryFn: async ({ signal }): Promise<readonly ApprovedTool[]> => {
      const { approvals } = await client.request(
        integrationPath(integrationId, "/approvals"),
        approvedToolListResponseSchema,
        { locale, signal },
      );

      return approvals;
    },
  });
}

/**
 * Guard: `enabled` is the caller's, so the card mounts this only while its list
 * is open. A reader with a dozen servers would otherwise pay for a dozen reads
 * to render a page where every list is collapsed.
 */
export function useIntegrationApprovals(
  integrationId: string,
  locale: Locale,
  enabled: boolean,
) {
  return useQuery({
    ...integrationApprovalsOptions(useChatClient(), locale, integrationId),
    enabled,
  });
}

/**
 * The reader's grants for the tools this product ships.
 *
 * Guard: keyed apart from the per-integration lists but under the same prefix,
 * so remembering or forgetting anything sweeps both. A first-party grant has no
 * integration to be listed under, which is why it needs a query of its own — and
 * why for as long as it had none, there was nowhere to withdraw one.
 */
export function chatToolApprovalsOptions(client: ChatClient, locale: Locale) {
  return queryOptions({
    queryKey: connectionKeys.chatToolApprovals(),
    queryFn: async ({ signal }): Promise<readonly ApprovedTool[]> => {
      const { approvals } = await client.request(
        INTEGRATION_PATHS.approvals,
        approvedToolListResponseSchema,
        { locale, signal },
      );

      return approvals;
    },
  });
}

export function useChatToolApprovals(locale: Locale, enabled: boolean) {
  return useQuery({
    ...chatToolApprovalsOptions(useChatClient(), locale),
    enabled,
  });
}

export function chatToolsOptions(client: ChatClient, locale: Locale) {
  return queryOptions({
    queryKey: connectionKeys.chatTools(),
    queryFn: async ({ signal }): Promise<readonly ChatToolEntry[]> => {
      const { tools } = await client.request(
        `${INTEGRATION_PATHS.approvals}/tools`,
        chatToolListResponseSchema,
        { locale, signal },
      );

      return tools;
    },
  });
}

export function useChatTools(locale: Locale) {
  return useQuery(chatToolsOptions(useChatClient(), locale));
}

/**
 * Guard: keyed under the approvals prefix, so setting an override sweeps it
 * together with the remembered lists that sit beside it on the card.
 */
export function integrationToolsOptions(
  client: ChatClient,
  locale: Locale,
  integrationId: string,
) {
  return queryOptions({
    queryKey: connectionKeys.tools(integrationId),
    queryFn: async ({ signal }): Promise<readonly IntegrationTool[]> => {
      const { tools } = await client.request(
        integrationPath(integrationId, "/tools"),
        integrationToolListResponseSchema,
        { locale, signal },
      );

      return tools;
    },
  });
}

export function useIntegrationTools(
  integrationId: string,
  locale: Locale,
  enabled: boolean,
) {
  return useQuery({
    ...integrationToolsOptions(useChatClient(), locale, integrationId),
    enabled,
  });
}
