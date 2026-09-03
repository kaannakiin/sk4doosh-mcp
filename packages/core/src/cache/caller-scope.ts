import { createHash } from "node:crypto";

export type CallerScopeKey = string & { readonly __brand: "CallerScopeKey" };

export type CacheTag = `${string}:${string}`;

export interface CallerScope {
  readonly key: CallerScopeKey;
  readonly tags: readonly CacheTag[];
}

export type CarrierHeaderLookup = (
  name: string,
) => string | readonly string[] | undefined;

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function digestInput(
  carriers: readonly string[],
  header: CarrierHeaderLookup,
): string {
  const sorted = [...carriers].sort((a, bb) =>
    ordinal(a.toLowerCase(), bb.toLowerCase()),
  );
  let text = "";
  for (const carrier of sorted) {
    const value = header(carrier);
    const flat =
      value === undefined
        ? ""
        : Array.isArray(value)
          ? value.join(",")
          : (value as string);
    text += `${carrier.toLowerCase()}=${flat}\n`;
  }
  return text;
}

export function deriveCallerScopeKey(digest: string): CallerScopeKey {
  return createHash("sha256")
    .update(digest, "utf8")
    .digest("hex") as CallerScopeKey;
}

const whitespacePattern = /\s/;
const tagPattern = /^\S+:\S+$/;

export function createCallerScope(
  key: string,
  tags: readonly string[] = [],
): CallerScope {
  if (key.length === 0) {
    throw new RangeError("CallerScope key must not be empty");
  }
  if (whitespacePattern.test(key)) {
    throw new RangeError("CallerScope key must not contain whitespace");
  }
  if (key.includes(":")) {
    throw new RangeError("CallerScope key must not contain ':'");
  }
  for (const tag of tags) {
    if (!tagPattern.test(tag)) {
      throw new TypeError(
        `Cache tag '${tag}' must have the form 'kind:value' with no whitespace`,
      );
    }
  }
  return {
    key: key as CallerScopeKey,
    tags: tags as readonly CacheTag[],
  };
}
