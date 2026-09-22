const decodeProlog = (bytes, limit) => {
  const head = bytes.subarray(0, Math.min(bytes.length, limit));
  if (
    head.length >= 3 &&
    head[0] === 0xef &&
    head[1] === 0xbb &&
    head[2] === 0xbf
  ) {
    return { text: head.subarray(3).toString("utf8"), family: "utf8" };
  }
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) {
    return { text: head.subarray(2).toString("utf16le"), family: "utf16le" };
  }
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) {
    const swapped = Buffer.from(head.subarray(2));
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const first = swapped[index];
      swapped[index] = swapped[index + 1];
      swapped[index + 1] = first;
    }
    return { text: swapped.toString("utf16le"), family: "utf16be" };
  }
  if (head.length >= 4 && head[0] === 0x00 && head[2] === 0x00) {
    const swapped = Buffer.from(head);
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const first = swapped[index];
      swapped[index] = swapped[index + 1];
      swapped[index + 1] = first;
    }
    return { text: swapped.toString("utf16le"), family: "utf16be" };
  }
  if (head.length >= 4 && head[1] === 0x00 && head[3] === 0x00) {
    return { text: head.toString("utf16le"), family: "utf16le" };
  }
  return { text: head.toString("utf8"), family: "utf8" };
};

export const candidateA = (bytes) => ({
  doctype: /<!DOCTYPE/i.test(bytes.toString("utf8")),
});

export const candidateB = (bytes) => ({
  doctype: bytes.includes(Buffer.from("<!DOCTYPE", "latin1")),
});

export const candidateC = (bytes, limit = 65_536) => {
  const { text } = decodeProlog(bytes, limit);
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (
      character === " " ||
      character === "\t" ||
      character === "\r" ||
      character === "\n"
    ) {
      index += 1;
      continue;
    }
    if (character !== "<") {
      return { doctype: false, malformed: true, reason: "content_before_root" };
    }
    if (text.startsWith("<?", index)) {
      const end = text.indexOf("?>", index + 2);
      if (end < 0) {
        return bytes.length > limit
          ? { doctype: false, limitReached: true }
          : { doctype: false, malformed: true, reason: "unterminated_pi" };
      }
      index = end + 2;
      continue;
    }
    if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      if (end < 0) {
        return bytes.length > limit
          ? { doctype: false, limitReached: true }
          : { doctype: false, malformed: true, reason: "unterminated_comment" };
      }
      index = end + 3;
      continue;
    }
    if (text.startsWith("<!DOCTYPE", index)) {
      const after = text[index + 9];
      if (after === undefined) return { doctype: true };
      if (!/[\s[>]/.test(after)) {
        return { doctype: false, malformed: true, reason: "doctype_no_space" };
      }
      return { doctype: true };
    }
    if (text.startsWith("<!", index)) {
      return {
        doctype: false,
        malformed: true,
        reason: "unexpected_markup_declaration",
      };
    }
    return { doctype: false };
  }
  return bytes.length > limit
    ? { doctype: false, limitReached: true }
    : { doctype: false, malformed: true, reason: "no_root_element" };
};

export const candidateD = (bytes, parse) => {
  try {
    const document = parse(bytes);
    const seen = document.dtd !== null;
    document.dispose();
    return { doctype: seen };
  } catch {
    return { doctype: false, parseFailed: true };
  }
};
