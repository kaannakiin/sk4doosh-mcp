import type { Vocabulary } from "@sk-mcp/mcp-core";

export const vocabulary = {
  serverName: "llm-mcp",
  subject: "local model",
  listTool: "local_status",
} as const satisfies Vocabulary<string>;
