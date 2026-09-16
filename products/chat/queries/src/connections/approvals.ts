import type { Locale } from "@chat/contracts/common/locale";
import {
  approvedToolListResponseSchema,
  type ApprovedTool,
} from "@chat/contracts/integration/tool-approval";
import { queryOptions, useQuery } from "@tanstack/react-query";

import type { ChatClient } from "../client.ts";
import { useChatClient } from "../provider.tsx";
import { connectionKeys } from "./keys.ts";
import { integrationPath } from "./path.ts";

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
