import { createHash } from "node:crypto";

declare const fingerprintBrand: unique symbol;

export type Fingerprint = string & { readonly [fingerprintBrand]: true };

export interface CursorEnvelope {
  readonly v: 1;
  readonly f: Fingerprint;
}

export type Cursor<TPosition> = [
  Extract<keyof TPosition, keyof CursorEnvelope>,
] extends [never]
  ? CursorEnvelope & TPosition
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

export function encodeCursor<TCursor extends CursorEnvelope>(
  cursor: TCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursorPayload(raw: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

export function isFresh(cursor: CursorEnvelope, current: Fingerprint): boolean {
  return cursor.f === current;
}
