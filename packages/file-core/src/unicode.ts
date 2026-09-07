const nonSpacingMark = /\p{Mn}/gu;

export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(nonSpacingMark, "")
    .toUpperCase()
    .toLowerCase()
    .normalize("NFC");
}

export function canonical(text: string): string {
  return text.normalize("NFC");
}

export function asciiLower(text: string): string {
  let out = "";
  for (const character of text) {
    out +=
      character >= "A" && character <= "Z"
        ? String.fromCharCode(character.charCodeAt(0) + 32)
        : character;
  }
  return out;
}

export function asciiUpper(text: string): string {
  let out = "";
  for (const character of text) {
    out +=
      character >= "a" && character <= "z"
        ? String.fromCharCode(character.charCodeAt(0) - 32)
        : character;
  }
  return out;
}

export function truncateWellFormed(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const code = text.charCodeAt(limit - 1);
  const cut = code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
  return text.slice(0, cut);
}
