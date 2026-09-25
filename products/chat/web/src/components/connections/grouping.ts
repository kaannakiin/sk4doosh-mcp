import type { Locale } from "@chat/contracts/common/locale";
import type { IntegrationOrigin } from "@chat/contracts/integration/integration";
import type { IntegrationSummary } from "@chat/contracts/integration/registration";

export const STATUS_GROUPS = [
  "attention",
  "connected",
  "disconnected",
] as const;

export type StatusGroup = (typeof STATUS_GROUPS)[number];

export function isStatusGroup(value: unknown): value is StatusGroup {
  return STATUS_GROUPS.some((group) => group === value);
}

export function isIntegrationOrigin(
  value: unknown,
): value is IntegrationOrigin {
  return value === "partner" || value === "user";
}

/**
 * Guard: only `reauth_required` is attention. A `revoked` connection is one the
 * reader withdrew themselves, and ranking it beside a server that stopped
 * accepting its token would bury the one row that needs acting on.
 */
export function statusGroupOf(integration: IntegrationSummary): StatusGroup {
  if (integration.authMode === "none") {
    return "connected";
  }

  const status = integration.connection?.status;

  return status === "active"
    ? "connected"
    : status === "reauth_required"
      ? "attention"
      : "disconnected";
}

export interface IntegrationFilters {
  readonly query: string;
  readonly status: StatusGroup | undefined;
  readonly origin: IntegrationOrigin | undefined;
  readonly locale: Locale;
}

export interface IntegrationGroup {
  readonly group: StatusGroup;
  readonly integrations: readonly IntegrationSummary[];
}

export function matchesQuery(
  haystacks: readonly (string | null)[],
  needle: string,
  locale: Locale,
): boolean {
  return (
    needle === "" ||
    haystacks.some(
      (value) =>
        value !== null && value.toLocaleLowerCase(locale).includes(needle),
    )
  );
}

export function groupIntegrations(
  integrations: readonly IntegrationSummary[],
  filters: IntegrationFilters,
): readonly IntegrationGroup[] {
  const needle = filters.query.trim().toLocaleLowerCase(filters.locale);
  const buckets = new Map<StatusGroup, IntegrationSummary[]>(
    STATUS_GROUPS.map((group) => [group, []]),
  );

  for (const integration of integrations) {
    const group = statusGroupOf(integration);
    if (
      (filters.status === undefined || filters.status === group) &&
      (filters.origin === undefined || filters.origin === integration.origin) &&
      matchesQuery(
        [integration.displayName, integration.mcpUrl],
        needle,
        filters.locale,
      )
    ) {
      buckets.get(group)?.push(integration);
    }
  }

  return STATUS_GROUPS.flatMap((group) => {
    const members = buckets.get(group) ?? [];

    return members.length === 0 ? [] : [{ group, integrations: members }];
  });
}

export interface IntegrationTally {
  readonly connected: number;
  readonly attention: number;
  readonly tools: number;
  readonly origins: number;
}

export function tallyIntegrations(
  integrations: readonly IntegrationSummary[],
): IntegrationTally {
  let connected = 0;
  let attention = 0;
  let tools = 0;
  const origins = new Set<IntegrationOrigin>();

  for (const integration of integrations) {
    const group = statusGroupOf(integration);
    connected += group === "connected" ? 1 : 0;
    attention += group === "attention" ? 1 : 0;
    tools += integration.toolCount;
    origins.add(integration.origin);
  }

  return { connected, attention, tools, origins: origins.size };
}

export function hostOf(mcpUrl: string): string {
  try {
    return new URL(mcpUrl).host;
  } catch {
    return mcpUrl;
  }
}
