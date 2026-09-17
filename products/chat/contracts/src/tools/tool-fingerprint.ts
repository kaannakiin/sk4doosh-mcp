import { z } from "zod";

import { CODEX_TOOL_SCHEMAS } from "./codex/catalog.ts";
import { DISCOVERY_TOOL_SCHEMAS } from "./discovery/catalog.ts";
import { EXCEL_TOOL_SCHEMAS } from "./excel/catalog.ts";
import type { ChatToolName } from "./tool-name.ts";
import { XML_TOOL_SCHEMAS } from "./xml/catalog.ts";

const SCHEMAS: Record<ChatToolName, { inputSchema: z.ZodType }> = {
  ...EXCEL_TOOL_SCHEMAS,
  ...XML_TOOL_SCHEMAS,
  ...DISCOVERY_TOOL_SCHEMAS,
  ...CODEX_TOOL_SCHEMAS,
};

/**
 * What a first-party tool's definition is fingerprinted from.
 *
 * Guard: the tool's own description is not in here, and that is the whole point
 * of fingerprinting the JSON Schema rather than the tool object. A first-party
 * description is read out of the locale files at call time, so a digest that
 * included it would change when the reader changed language and drop every
 * grant they had given. The field descriptions that `.describe()` puts into the
 * schema do belong: those are English literals in this package, they are what
 * the model is told each argument means, and an edit to one is a change of
 * meaning exactly as it is for a remote tool.
 *
 * Guard: the shape is returned, not hashed. Hashing needs `node:crypto`, and
 * this package is also bundled for the browser — the api digests these with the
 * same canonical serializer it already uses for remote tools, so both families
 * are fingerprinted by one piece of code.
 *
 * Guard: a zod upgrade that changes `toJSONSchema`'s output invalidates every
 * first-party grant at once and the reader is asked again. That is the failure
 * this should have: it errs towards asking.
 */
export const CHAT_TOOL_DEFINITIONS: Record<ChatToolName, unknown> =
  Object.fromEntries(
    Object.entries(SCHEMAS).map(([name, { inputSchema }]) => [
      name,
      { name, inputSchema: z.toJSONSchema(inputSchema) },
    ]),
  ) as Record<ChatToolName, unknown>;

export function definitionOf(toolName: ChatToolName): unknown {
  return CHAT_TOOL_DEFINITIONS[toolName];
}
