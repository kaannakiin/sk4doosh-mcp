function hardSplit(line: string, maxChars: number): readonly string[] {
  const characters = Array.from(line);
  return Array.from(
    { length: Math.ceil(characters.length / maxChars) },
    (_, index) =>
      characters.slice(index * maxChars, (index + 1) * maxChars).join(""),
  );
}

function piecesOf(text: string, maxChars: number): readonly string[] {
  return text
    .split(/\n{2,}/u)
    .flatMap((paragraph) =>
      paragraph.length <= maxChars
        ? [paragraph]
        : paragraph
            .split("\n")
            .flatMap((line) =>
              line.length <= maxChars ? [line] : hardSplit(line, maxChars),
            ),
    );
}

/**
 * Splits text into chunks of at most `maxChars`, preferring paragraph breaks,
 * then line breaks, and cutting inside a line only when one line alone is too
 * long. Nothing is dropped; only the whitespace between pieces may change.
 */
export function chunkText(text: string, maxChars: number): readonly string[] {
  const chunks: string[] = [];
  let current = "";
  for (const piece of piecesOf(text, maxChars)) {
    const joined = current === "" ? piece : `${current}\n\n${piece}`;
    if (joined.length > maxChars && current !== "") {
      chunks.push(current);
      current = piece;
    } else {
      current = joined;
    }
  }
  chunks.push(current);
  return chunks.filter((chunk) => chunk.trim() !== "");
}
