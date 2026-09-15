import { z } from "zod";

import {
  connectionScopeSchema,
  type ConnectionScope,
} from "./connection-scope.ts";
import {
  remoteToolNameSchema,
  type RemoteToolName,
} from "./remote-tool-name.ts";

export const integrationScopeMapSchema = z.record(
  connectionScopeSchema,
  z.array(remoteToolNameSchema).min(1),
);

export type IntegrationScopeMap = z.infer<typeof integrationScopeMapSchema>;

export type ScopeRequirement =
  | { readonly kind: "scope"; readonly scope: ConnectionScope }
  | { readonly kind: "unmapped" }
  | { readonly kind: "ambiguous"; readonly scopes: readonly ConnectionScope[] };

/**
 * Resolves the scope a partner tool requires.
 *
 * Guard: the map is read by iterating its entries, never by indexing it with
 * the requested name. The name arrives from a model-authored tool call, and
 * indexing a plain object with `__proto__` or `constructor` resolves on the
 * prototype and hands back a value that is not a tool list.
 *
 * @param scopeMap the partner's published scope to tool mapping
 * @param toolName the tool the model asked for
 * @returns `unmapped` for a tool no scope lists and `ambiguous` for a tool more
 * than one scope lists; both are denials at the call site, never a pass
 */
export function scopeRequirementFor(
  scopeMap: IntegrationScopeMap,
  toolName: RemoteToolName,
): ScopeRequirement {
  const scopes: ConnectionScope[] = [];
  for (const [scope, tools] of Object.entries(scopeMap)) {
    if (tools.includes(toolName)) {
      scopes.push(scope);
    }
  }

  const [only, ...rest] = scopes;
  if (only === undefined) {
    return { kind: "unmapped" };
  }

  return rest.length === 0
    ? { kind: "scope", scope: only }
    : { kind: "ambiguous", scopes };
}

/**
 * Guard: a tool two scopes list is refused when the manifest is ingested, not
 * resolved when it is invoked. Resolving it would have to choose, and choosing
 * the narrower scope widens the grant while choosing the wider one breaks the
 * user who consented to the narrower.
 *
 * @param scopeMap the mapping to inspect
 * @returns every tool name more than one scope lists
 */
export function scopeMapConflicts(
  scopeMap: IntegrationScopeMap,
): readonly RemoteToolName[] {
  const seen = new Set<RemoteToolName>();
  const conflicts = new Set<RemoteToolName>();

  for (const tools of Object.values(scopeMap)) {
    for (const tool of new Set(tools)) {
      if (seen.has(tool)) {
        conflicts.add(tool);
      }
      seen.add(tool);
    }
  }

  return [...conflicts];
}
