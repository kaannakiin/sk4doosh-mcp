import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptedPdf, pdfWithPages, textPdf } from "./pdf.js";

export interface Fixtures {
  readonly root: string;
  readonly outside: string;
  readonly text: string;
  readonly scanned: string;
  readonly mixedPages: string;
  readonly many: string;
  readonly truncated: string;
  readonly empty: string;
  readonly garbage: string;
  readonly encrypted: string;
  readonly notPdf: string;
  readonly wide: string;
  readonly alternating: string;
  readonly long: string;
}

const textPages = [
  ["Invoice No: 2026-0917", "Customer: Acme Ltd", "Total: 1.250,00 TRY"],
  ["Invoice No: 2026-1188", "Customer: Beta AS", "Total: 480,00 TRY"],
  ["Summary page", "Grand total: 1.730,00 TRY"],
];

export async function buildFixtures(): Promise<Fixtures> {
  const root = await mkdtemp(join(tmpdir(), "pdf-mcp-fixtures-"));
  const nested = join(root, "nested");
  await mkdir(nested, { recursive: true });
  const outsideRoot = await mkdtemp(join(tmpdir(), "pdf-mcp-outside-"));

  const write = async (name: string, bytes: Buffer): Promise<string> => {
    await writeFile(join(root, name), bytes);
    return name;
  };

  const full = textPdf(textPages);
  await writeFile(join(outsideRoot, "outside.pdf"), full);

  const fixtures: Fixtures = {
    root,
    outside: join(outsideRoot, "outside.pdf"),
    text: await write("text.pdf", full),
    scanned: await write("scanned.pdf", pdfWithPages([{ kind: "image" }])),
    mixedPages: await write(
      "mixed.pdf",
      pdfWithPages([
        { kind: "text", lines: ["Page one carries the token ALPHA"] },
        { kind: "image" },
        { kind: "text", lines: ["Page three carries the token OMEGA"] },
      ]),
    ),
    many: await write(
      "many.pdf",
      textPdf(
        Array.from({ length: 40 }, (_unused, index) => [
          `Page ${String(index + 1)} marker MARK${String(index + 1)}`,
        ]),
      ),
    ),
    truncated: await write("truncated.pdf", full.subarray(0, 120)),
    empty: await write("empty.pdf", Buffer.alloc(0)),
    garbage: await write(
      "garbage.pdf",
      Buffer.concat([
        Buffer.from("%PDF-1.7\n", "latin1"),
        Buffer.from("this is not a pdf body ".repeat(20), "latin1"),
      ]),
    ),
    encrypted: await write("encrypted.pdf", encryptedPdf()),
    notPdf: await write("notes.txt", Buffer.from("plain text", "utf8")),
    long: await write(
      "long.pdf",
      pdfWithPages([
        {
          kind: "text",
          /**
           * Prose, not filler: the engine's own quality heuristic marks a page
           * of repeated nonsense as untrustworthy and extracts nothing from it,
           * which would make this fixture silently empty.
           */
          lines: Array.from(
            { length: 12 },
            (_unused, index) =>
              `Line ${String(index).padStart(2, "0")} the quick brown fox jumps over the lazy dog`,
          ),
        },
        { kind: "text", lines: ["second page body"] },
      ]),
    ),
    alternating: await write(
      "alternating.pdf",
      pdfWithPages([
        { kind: "text", lines: ["page one text"] },
        { kind: "image" },
        { kind: "text", lines: ["page three text"] },
        { kind: "image" },
      ]),
    ),
    wide: await write(
      "wide.pdf",
      textPdf([[`WIDE ${"x".repeat(900)}`], ["second page"]]),
    ),
  };
  await writeFile(join(nested, "deep.pdf"), full);
  return fixtures;
}
