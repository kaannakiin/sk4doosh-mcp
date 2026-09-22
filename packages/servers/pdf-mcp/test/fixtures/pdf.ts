/**
 * Minimal PDF writer for fixtures: assembles numbered objects and computes a
 * correct xref table, so the engine sees structurally valid files rather than
 * something it rejects for an unrelated reason.
 */
function assemble(objects: readonly string[], trailerExtra = ""): Buffer {
  const header = "%PDF-1.7\n";
  const chunks: Buffer[] = [Buffer.from(header, "latin1")];
  let offset = header.length;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    const text = `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
    offsets.push(offset);
    const buffer = Buffer.from(text, "latin1");
    chunks.push(buffer);
    offset += buffer.length;
  });
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const value of offsets) {
    xref += `${String(value).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<</Size ${String(objects.length + 1)}/Root 1 0 R${trailerExtra}>>\nstartxref\n${String(offset)}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}

function stream(dictionary: string, data: string): string {
  const length = Buffer.byteLength(data, "latin1");
  return `<<${dictionary}/Length ${String(length)}>>\nstream\n${data}\nendstream`;
}

function textContent(lines: readonly string[]): string {
  const body = lines
    .map(
      (line, index) =>
        `1 0 0 1 72 ${String(700 - index * 24)} Tm\n(${line}) Tj\n`,
    )
    .join("");
  return `BT\n/F1 18 Tf\n${body}ET\n`;
}

const imageContent = "q\n500 0 0 700 56 56 cm\n/Im1 Do\nQ\n";

function imageObject(): string {
  const pixels = Buffer.from([
    0xff, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00,
  ]).toString("latin1");
  return stream(
    "/Type/XObject/Subtype/Image/Width 2/Height 2/ColorSpace/DeviceRGB/BitsPerComponent 8",
    pixels,
  );
}

export type PageSpec =
  | { readonly kind: "text"; readonly lines: readonly string[] }
  | { readonly kind: "image" };

export function pdfWithPages(specs: readonly PageSpec[]): Buffer {
  const objects: string[] = [
    "",
    "",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    imageObject(),
  ];
  const pageRefs: string[] = [];
  for (const spec of specs) {
    const pageNumber = objects.length + 1;
    const contentNumber = objects.length + 2;
    const resources =
      spec.kind === "text"
        ? "<</Font<</F1 3 0 R>>>>"
        : "<</XObject<</Im1 4 0 R>>>>";
    objects.push(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources${resources}/Contents ${String(contentNumber)} 0 R>>`,
    );
    objects.push(
      stream("", spec.kind === "text" ? textContent(spec.lines) : imageContent),
    );
    pageRefs.push(`${String(pageNumber)} 0 R`);
  }
  objects[0] = "<</Type/Catalog/Pages 2 0 R>>";
  objects[1] = `<</Type/Pages/Kids[${pageRefs.join(" ")}]/Count ${String(specs.length)}>>`;
  return assemble(objects);
}

export function textPdf(pages: readonly (readonly string[])[]): Buffer {
  return pdfWithPages(pages.map((lines) => ({ kind: "text", lines })));
}

/** Carries an /Encrypt entry in the trailer, which the engine refuses outright. */
export function encryptedPdf(): Buffer {
  return assemble(
    [
      "<</Type/Catalog/Pages 2 0 R>>",
      "<</Type/Pages/Kids[3 0 R]/Count 1>>",
      "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>",
      stream("", textContent(["secret"])),
      "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
      "<</Filter/Standard/V 2/R 3/Length 128/P -1/O <0123456789abcdef0123456789abcdef>/U <fedcba9876543210fedcba9876543210>>>",
    ],
    "/Encrypt 6 0 R/ID[<0123456789abcdef0123456789abcdef><0123456789abcdef0123456789abcdef>]",
  );
}
