import { createHash, hkdfSync } from "node:crypto";

const EMPTY_SALT = Buffer.alloc(0);

export function sha256Bytes(value: string | Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

export function deriveSha256Key(
  root: Uint8Array,
  label: string,
  length = 32,
): Buffer {
  return Buffer.from(
    hkdfSync("sha256", root, EMPTY_SALT, Buffer.from(label), length),
  );
}
