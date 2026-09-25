import type { AgentApprovalAnswer } from "@chat/contracts/agent/approval";
import type { AgentSelection } from "@chat/contracts/agent/model";
import type { Locale } from "@chat/contracts/common/locale";
import { useMutation } from "@tanstack/react-query";

import { useChatClient } from "../provider.tsx";
import { agentKeys } from "./keys.ts";
import { AGENT_PATHS, agentApprovalPath } from "./path.ts";

export function useSetDefaultAgentSelection(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, AgentSelection>({
    mutationFn: (body) =>
      client.requestNoContent(AGENT_PATHS.selection, {
        method: "PUT",
        locale,
        body,
      }),
    onSettled: (_data, _error, _input, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({ queryKey: agentKeys.catalogs() }),
  });
}

export interface AgentApprovalInput extends AgentApprovalAnswer {
  readonly approvalId: string;
}

export function useAnswerAgentApproval(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, AgentApprovalInput>({
    mutationFn: ({ approvalId, approved, remembered }) =>
      client.requestNoContent(agentApprovalPath(approvalId), {
        method: "POST",
        locale,
        body: { approved, remembered },
      }),
  });
}
