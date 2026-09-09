/**
 * A copy of file-core's asciiLower, because the worker may not import the core
 * (K7) and the repository forbids locale-dependent casing: toLowerCase would
 * fold the Turkish dotted I differently per locale. ASCII-only is the whole
 * contract that caseSensitive: false offers, and the schema says so.
 */
export function asciiLower(text: string): string {
  let folded = "";
  for (const character of text) {
    folded +=
      character >= "A" && character <= "Z"
        ? String.fromCharCode(character.charCodeAt(0) + 32)
        : character;
  }
  return folded;
}
