import type { Locale } from "@chat/contracts/common/locale";
import {
  approvedToolListResponseSchema,
  type ApprovedTool,
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
