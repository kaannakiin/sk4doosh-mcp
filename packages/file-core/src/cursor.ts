import { createHash } from "node:crypto";

declare const fingerprintBrand: unique symbol;

export type Fingerprint = string & { readonly [fingerprintBrand]: true };

export interface CursorEnvelope<V extends 1 | 2 = 1> {
  readonly v: V;
  readonly f: Fingerprint;
}

export type Cursor<TPosition, V extends 1 | 2 = 1> = [
  Extract<keyof TPosition, keyof CursorEnvelope>,
] extends [never]
  ? CursorEnvelope<V> & TPosition
  : never;

export function fingerprint(
  realPath: string,
  mtimeMs: number,
  size: number,
): Fingerprint {
  return createHash("sha256")
    .update(`${realPath}:${mtimeMs}:${size}`)
    .digest("hex")
    .slice(0, 16) as Fingerprint;
}

/**
 * Content identity includes parser variant and path, not just filesystem
 * metadata. The digest covers every byte, which is what makes a content change
 * under a restored mtime and an unchanged size detectable; documents.spec.ts
 * pins that property, and it must survive the digest moving into C++.
 */
export function fingerprintFromDigest(
  path: string,
  digest: Uint8Array,
  variant = "",
): Fingerprint {
  return createHash("sha256")
    .update(JSON.stringify([path, variant]))
    .update("\0")
    .update(digest)
    .digest("hex") as Fingerprint;
}

export function contentFingerprint(
  path: string,
  bytes: Uint8Array,
  variant = "",
): Fingerprint {
  return fingerprintFromDigest(
    path,
    createHash("sha256").update(bytes).digest(),
    variant,
  );
}

export function encodeCursor<TCursor extends CursorEnvelope<1 | 2>>(
  cursor: TCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursorPayload(raw: string): unknown {
  if (raw.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(raw)) return undefined;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

export function isFresh(
  cursor: CursorEnvelope<1 | 2>,
  current: Fingerprint,
): boolean {
  return cursor.f === current;
}
