/** What `invoke_tool` will compose with, and whether the caller sent it that way. */
export interface NormalizedInvokeArguments {
  readonly value: unknown;
  /** The caller sent JSON text and it was parsed into this object. */
  readonly unwrapped: boolean;
}

/**
 * Normalizes the `arguments` value `invoke_tool` received before composition.
 *
 * Guard: the meta-tool publishes `arguments` with no `type`, so the transport
 * hands the handler whatever arrived. Two shapes are accepted that the composer
 * itself refuses. `null` is absence — nothing downstream can tell it from an
 * omitted object, because composition only enumerates properties. JSON *text*
 * is a client defect, not an intent: no operation can want a string here, so
 * parsing one is unambiguous. It is unwrapped rather than refused because the
 * refusal costs the agent the whole turn, and `unwrapped` is returned so the
 * host can say so — silence would hide a client that double-encodes every call.
 *
 * @param raw the value the transport bound to `arguments`
 * @returns the value to compose with, and whether it came from JSON text
 */
export function normalizeInvokeArguments(
  raw: unknown,
): NormalizedInvokeArguments {
  if (raw === undefined || raw === null) {
    return { value: {}, unwrapped: false };
  }
  if (typeof raw !== "string") {
    return { value: raw, unwrapped: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: raw, unwrapped: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { value: raw, unwrapped: false };
  }
  return { value: parsed, unwrapped: true };
}
