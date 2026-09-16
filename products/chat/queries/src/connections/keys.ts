/**
 * Guard: connections do not hang off `chatKeys.all`. Signing out sweeps that
 * prefix, and a page that lists somebody's own servers must be swept by the same
 * call — but a mutation that patches the list must not reach into the session
 * caches, which nesting under one prefix would make possible by accident.
 */
export const connectionKeys = {
  all: ["connections"] as const,
  integrations: () => [...connectionKeys.all, "integrations"] as const,
} as const;
