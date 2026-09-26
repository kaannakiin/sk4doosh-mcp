/**
 * A copy of file-core's asciiLower, because this package declares no `@liaiso/*`
 * dependency and the repository forbids locale-dependent casing: toLowerCase
 * would fold the Turkish dotted I differently per locale. OPC compares part
 * names and Default extensions ASCII-case-insensitively, which is exactly the
 * contract this offers and no more.
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
