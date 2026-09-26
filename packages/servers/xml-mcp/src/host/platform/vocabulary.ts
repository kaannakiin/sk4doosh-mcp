import type { Vocabulary } from "@liaiso/file-core";

export const vocabulary = {
  serverName: "xml-mcp",
  subject: "document",
  rootLabel: "XML source root",
  readableLabel: "readable XML document",
  listTool: "list_documents",
  tooLargeRecovery:
    "Split the document or read a smaller file; XML files are parsed up to 8 MiB.",
} as const satisfies Vocabulary<string>;
