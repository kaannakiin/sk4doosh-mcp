import type {
  AgentApproval,
  AgentApprovalStatus,
} from "@chat/contracts/agent/approval";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { ApprovalControls, type ToolDecision } from "./ApprovalControls";

export interface AgentApprovalPartProps {
  readonly approval: AgentApproval;
  readonly live: boolean;
  readonly onDecision: (decision: ToolDecision) => void;
}

/**
 * Guard: a hold still marked pending once the turn stopped streaming is shown
 * as expired. The gateway expires every open hold when its turn ends, but a
 * stream cut off before that write arrived leaves the last status the page saw,
 * and offering buttons for it would send an answer nobody is waiting for.
 */
function statusOf(approval: AgentApproval, live: boolean): AgentApprovalStatus {
  return approval.status === "pending" && !live ? "expired" : approval.status;
}

function AgentApprovalPartComponent({
  approval,
  live,
  onDecision,
}: AgentApprovalPartProps) {
  const { t } = useTranslation();
  const status = statusOf(approval, live);

  return (
    <section
      className="group/approval mt-4 rounded-[10px] border border-hairline bg-panel px-3.5 py-3 data-[status=denied]:border-red data-[status=expired]:border-hairline-strong data-[status=pending]:border-amber"
      data-status={status}
    >
      <header className="flex items-center justify-between gap-3">
        <span className="font-mono text-[0.8125rem] font-medium">
          {t(`tool.names.${approval.tool}`, { defaultValue: approval.tool })}
          <span className="ms-2 font-sans text-xs font-normal text-ink-dim">
            {approval.server}
          </span>
        </span>
        <span className="text-[0.6875rem] tracking-widest whitespace-nowrap text-ink-dim uppercase group-data-[status=approved]/approval:text-green group-data-[status=denied]/approval:text-red group-data-[status=pending]/approval:text-amber">
          {t(`agents.approval.status.${status}`)}
        </span>
      </header>

      {approval.reason === "" ? null : (
        <p className="mt-2 text-[0.8125rem] text-ink-dim">{approval.reason}</p>
      )}

      {status === "pending" ? (
        <ApprovalControls
          channel="gateway"
          approvalId={approval.approvalId}
          toolName={approval.tool}
          rememberable={approval.rememberable}
          onDecision={onDecision}
        />
      ) : null}
    </section>
  );
}

export const AgentApprovalPart = memo(AgentApprovalPartComponent);
