import type { SessionId } from "@chat/contracts/chat/session";

import { chatKeys } from "../keys.ts";

/**
 * Guard: nested under `chatKeys.all` because the catalog carries the reader's
 * own model choice, and signing out sweeps exactly that prefix.
 */
export const agentKeys = {
  all: [...chatKeys.all, "agent"] as const,
  catalogs: () => [...agentKeys.all, "catalog"] as const,
  catalog: (sessionId: SessionId | undefined) =>
    [...agentKeys.catalogs(), sessionId ?? null] as const,
} as const;
