import type { Vocabulary } from "@liaiso/file-core";

export const vocabulary = {
  serverName: "pdf-mcp",
  subject: "document",
  rootLabel: "PDF source root",
  readableLabel: "readable PDF document",
  listTool: "list_documents",
  tooLargeRecovery:
    "Read a smaller file; PDF documents are extracted up to 32 MiB.",
} as const satisfies Vocabulary<string>;
