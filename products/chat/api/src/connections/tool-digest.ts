import type { RemoteTool } from "@chat/contracts/integration/remote-tool";
import { CHAT_TOOL_DEFINITIONS } from "@chat/contracts/tools/tool-fingerprint";
import type { ChatToolName } from "@chat/contracts/tools/tool-name";

import { sha256Bytes } from "../common/utils/crypto.utils.ts";

/**
 * Guard: the label makes this a versioned format rather than "whatever we
 * hashed last release". Changing what goes into the digest invalidates every
 * stored approval, so it has to be a deliberate bump — the same reason
 * `deriveSha256Key` takes a label.
 */
const DOMAIN = "mcp-tool-v1\n";

/**
 * Guard: a label of its own, so the two families cannot be compared by accident.
 * A first-party fingerprint covers a different shape than a remote one — no
 * annotations, and no tool-level description, because that text is read out of
 * the locale files and a digest carrying it would drop every grant the day the
 * reader switched language.
 */
const CHAT_DOMAIN = "chat-tool-v1\n";

/**
 * Guard: keys are sorted by code unit and arrays keep their order. Sorting makes
 * the digest independent of the order a server happened to serialize its
 * properties in; keeping array order treats a reordered `anyOf` or `enum` as a
 * change, because there is no way to prove in general that it is not one.
 *
 * Guard: `JSON.stringify` is not used for the object case. V8 emits
 * integer-like keys first regardless of insertion order, so a schema with
 * properties named `1` and `a` would serialize differently depending on how the
 * object reached this process.
 */
function canonical(value: unknown): string {
  if (value === undefined) {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

/**
 * The fingerprint a remembered approval is bound to.
 *
 * Guard: computed here, at ingest, from what the server sent — never recomputed
 * from the stored row. A digest taken from jsonb would depend on key order
 * surviving Postgres, the driver and `JSON.parse` unchanged, and the day any of
 * those changed every reader would be asked about every tool again.
 *
 * Guard: `title` is excluded and `description` is not normalized. The title is
 * display text, so fixing its capitalization must not revoke consent; the
 * description is what the server tells the *model* the tool does, which makes it
 * the cheapest place to turn an approved tool into a different one. Any edit to
 * it is a change of meaning.
 *
 * @param tool the tool exactly as `listTools` parsed it
 * @returns the 32-byte digest stored beside the tool and beside each approval
 */
export function toolDefinitionDigest(tool: RemoteTool): Buffer {
  return sha256Bytes(
    DOMAIN +
      canonical({
        name: tool.name,
        description: tool.description,
        annotations: tool.annotations,
        inputSchema: tool.inputSchema,
      }),
  );
}

/**
 * The fingerprint a first-party grant is bound to.
 *
 * Guard: computed from the JSON Schema `@chat/contracts` exports, through the
 * same canonical serializer the remote path uses. The field descriptions that
 * `.describe()` puts into that schema are in it deliberately: they are English
 * literals in the contract layer and they are what the model is told each
 * argument means, so an edit to one is a change of meaning exactly as it is for
 * a discovered tool.
 *
 * @param toolName a tool this product ships
 * @returns the 32-byte digest stored beside each grant for it
 */
export function chatToolDigest(toolName: ChatToolName): Buffer {
  return sha256Bytes(CHAT_DOMAIN + canonical(CHAT_TOOL_DEFINITIONS[toolName]));
}
