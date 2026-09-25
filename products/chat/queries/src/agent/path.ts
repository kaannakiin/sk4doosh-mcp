import type { SessionId } from "@chat/contracts/chat/session";

export const AGENT_PATHS = {
  catalog: "/agent/catalog",
  selection: "/agent/selection",
  approvals: "/agent/approvals",
} as const;

export function agentApprovalPath(approvalId: string): string {
  return `${AGENT_PATHS.approvals}/${encodeURIComponent(approvalId)}`;
}

export function agentCatalogPath(sessionId: SessionId | undefined): string {
  return sessionId === undefined
    ? AGENT_PATHS.catalog
    : `${AGENT_PATHS.catalog}?sessionId=${encodeURIComponent(sessionId)}`;
}
