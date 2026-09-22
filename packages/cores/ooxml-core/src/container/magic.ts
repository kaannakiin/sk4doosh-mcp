import type { ContainerKind } from "../model/package.js";
import { startsWith } from "../primitives/bytes.js";

const zipLocalHeader = [0x50, 0x4b, 0x03, 0x04] as const;
const compoundFile = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;

/**
 * Classifies a container by its leading bytes.
 *
 * The compound-file signature is shared by the legacy binary formats and by an
 * encrypted OOXML document, which stores its package inside a compound file.
 * The two are not told apart here, so the caller phrases one refusal that covers
 * both rather than naming the wrong cause.
 *
 * @param magic the first bytes of the file; eight are enough.
 * @returns which container family the bytes belong to.
 */
export function classifyContainerMagic(magic: Uint8Array): ContainerKind {
  if (startsWith(magic, zipLocalHeader)) return "zip";
  if (startsWith(magic, compoundFile)) return "cfb";
  return "unknown";
}
