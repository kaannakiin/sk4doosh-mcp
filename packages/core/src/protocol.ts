import type { ProtocolRevision } from "./generated/protocol-revision.js";

/**
 * The revisions sk-mcp speaks, oldest first.
 *
 * `satisfies Record<ProtocolRevision, number>` is the guard: the generated union is the only
 * source of the revision set, so a revision added to or dropped from
 * `packages/spec/schemas/protocol-revision.schema.json` fails this file to compile until its
 * position is stated here. Without it the list drifts from the schema in silence and each
 * consumer negotiates against a different set.
 */
const order = {
  "2025-11-25": 0,
  "2026-07-28": 1,
} satisfies Record<ProtocolRevision, number>;

export const protocolRevisions: readonly ProtocolRevision[] = (
  Object.keys(order) as ProtocolRevision[]
).sort((left, right) => order[left] - order[right]);

export const defaultProtocolRevision: ProtocolRevision = "2026-07-28";

export function isProtocolRevision(value: string): value is ProtocolRevision {
  return Object.hasOwn(order, value);
}
