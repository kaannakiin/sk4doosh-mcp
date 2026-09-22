export type ByteOrderMark =
  "utf-8" | "utf-16le" | "utf-16be" | "utf-32le" | "utf-32be";

export interface BomMark {
  readonly encoding: ByteOrderMark;
  readonly length: number;
}

const marks = [
  { bytes: [0xff, 0xfe, 0x00, 0x00], encoding: "utf-32le" },
  { bytes: [0x00, 0x00, 0xfe, 0xff], encoding: "utf-32be" },
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be" },
] as const satisfies readonly {
  readonly bytes: readonly number[];
  readonly encoding: ByteOrderMark;
}[];

export function detectByteOrderMark(bytes: Uint8Array): BomMark | undefined {
  for (const mark of marks) {
    if (bytes.length < mark.bytes.length) {
      continue;
    }
    let matched = true;
    for (let index = 0; index < mark.bytes.length; index += 1) {
      if (bytes[index] !== mark.bytes[index]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { encoding: mark.encoding, length: mark.bytes.length };
    }
  }
  return undefined;
}
