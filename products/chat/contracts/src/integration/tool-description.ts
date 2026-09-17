const MAX_TITLE_CHARS = 120;

const MAX_DESCRIPTION_CHARS = 600;

const FENCE = /`{3,}/gu;

const BLANK_RUN = /\n{3,}/gu;

const LINE_FEED = 0x0a;

const TAB = 0x09;

/**
 * Guard: expressed as code points rather than a character class because the
 * ranges hold control and zero-width characters, which `no-control-regex` and
 * `no-irregular-whitespace` refuse inside a pattern.
 */
function discards(code: number): boolean {
  return (
    (code < 0x20 && code !== LINE_FEED) ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function clean(value: string): string {
  let kept = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === TAB) {
      kept += " ";
      continue;
    }

    if (!discards(code)) {
      kept += character;
    }
  }

  return kept
    .replace(FENCE, "`")
    .replace(/<\|/gu, "< ")
    .replace(/\|>/gu, " >")
    .replace(BLANK_RUN, "\n\n")
    .trim();
}

/**
 * Renders a remote tool's own title and description as the text handed to the
 * model.
 *
 * Guard: this runs on the way out, never at ingest. `toolDefinitionDigest`
 * hashes the description exactly as the server sent it, and a remembered
 * approval is bound to that digest — sanitizing first would make every edit to
 * this function revoke every stored grant, and would let two descriptions that
 * differ only in what this strips share one digest, which is the substitution
 * the digest exists to catch.
 *
 * Guard: the length cap is a context-window bound before it is a security one. A
 * server may publish 200 characters of title and 8192 of description per tool,
 * and a turn may reveal 24 tools — descriptions alone can exceed the whole
 * `CHAT_LLM_CONTEXT_TOKENS` budget several times over.
 *
 * Guard: bidi overrides, zero-width characters and chat-template boundary marks
 * are removed or broken because they separate what a human approving the call
 * reads from what the model reads. Fences collapse to one backtick rather than
 * being deleted, so a description that legitimately shows a code sample keeps
 * its meaning without being able to open a block.
 *
 * @param title the tool's title as the server published it
 * @param description the tool's description as the server published it
 * @returns the joined text, bounded and stripped, or an empty string
 */
export function sanitizeToolDescription(
  title: string | null | undefined,
  description: string | null | undefined,
): string {
  const parts: string[] = [];

  const head = typeof title === "string" ? clean(title) : "";
  if (head !== "") {
    parts.push(clamp(head, MAX_TITLE_CHARS));
  }

  const body = typeof description === "string" ? clean(description) : "";
  if (body !== "") {
    parts.push(body);
  }

  return clamp(parts.join(" — "), MAX_DESCRIPTION_CHARS);
}
