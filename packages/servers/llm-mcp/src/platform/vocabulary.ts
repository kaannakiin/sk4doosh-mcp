import type { Vocabulary } from "@liaiso/mcp-core";

export const vocabulary = {
  serverName: "llm-mcp",
  subject: "local model",
  listTool: "local_status",
} as const satisfies Vocabulary<string>;
