import { createHash } from "node:crypto";
import type { Fingerprint } from "@sk-mcp/mcp-core";

/**
 * Identity from filesystem metadata alone: cheap, and enough for a listing that
 * never read the bytes. A read that parsed the file stamps itself with
 * `contentFingerprint` instead.
 */
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
