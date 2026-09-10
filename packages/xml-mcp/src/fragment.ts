import type { InheritedContext } from "./boundary.js";

const encoder = new TextEncoder();

export const fragmentNamespace = "urn:x-skmcp:fragment";

/**
 * Returns a prefix that no declaration in `context` already binds. The wrapper
 * name must stay prefixed: a document with a default namespace re-declares it
 * here verbatim, and an unprefixed wrapper would land inside it.
 */
export function wrapperPrefix(context: InheritedContext): string {
  const taken = new Set(context.namespaces.map((entry) => entry.prefix));
  if (!taken.has("skmcp")) return "skmcp";
  for (let i = 0; ; i += 1) {
    const candidate = `skmcp${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function wrapRecord(
  bytes: Uint8Array,
  start: number,
  end: number,
  context: InheritedContext,
): Uint8Array {
  const prefix = wrapperPrefix(context);
  const parts = [
    `<${prefix}:f xmlns:${prefix}="${fragmentNamespace}"`,
    ...context.namespaces.map((entry) => entry.source),
    ...(context.lang === undefined ? [] : [context.lang]),
    ...(context.base === undefined ? [] : [context.base]),
    ...(context.space === undefined ? [] : [context.space]),
  ];
  const head = encoder.encode(`${parts.join(" ")}>`);
  const tail = encoder.encode(`</${prefix}:f>`);
  const record = bytes.subarray(start, end);
  const fragment = new Uint8Array(head.length + record.length + tail.length);
  fragment.set(head, 0);
  fragment.set(record, head.length);
  fragment.set(tail, head.length + record.length);
  return fragment;
}
