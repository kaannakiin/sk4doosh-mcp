/** Minimal PDF writer with a correct xref, so the renderer sees a valid file. */
function assemble(objects: readonly string[]): Buffer {
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
  xref += `trailer\n<</Size ${String(objects.length + 1)}/Root 1 0 R>>\nstartxref\n${String(offset)}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));
  return Buffer.concat(chunks);
}

export function textPdf(pages: readonly (readonly string[])[]): Buffer {
  const objects: string[] = [
    "",
    "",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  const refs: string[] = [];
  for (const lines of pages) {
    const pageNumber = objects.length + 1;
    const contentNumber = objects.length + 2;
    const content = `BT\n/F1 18 Tf\n${lines
      .map(
        (line, index) =>
          `1 0 0 1 72 ${String(700 - index * 24)} Tm\n(${line}) Tj\n`,
      )
      .join("")}ET\n`;
    objects.push(
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 3 0 R>>>>/Contents ${String(contentNumber)} 0 R>>`,
    );
    objects.push(
      `<</Length ${String(Buffer.byteLength(content, "latin1"))}>>\nstream\n${content}\nendstream`,
    );
    refs.push(`${String(pageNumber)} 0 R`);
  }
  objects[0] = "<</Type/Catalog/Pages 2 0 R>>";
  objects[1] = `<</Type/Pages/Kids[${refs.join(" ")}]/Count ${String(pages.length)}>>`;
  return assemble(objects);
}
