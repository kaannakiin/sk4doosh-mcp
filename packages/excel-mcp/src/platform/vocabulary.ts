import type { Vocabulary } from "@sk-mcp/file-core";

export const vocabulary = {
  serverName: "excel-mcp",
  subject: "workbook",
  rootLabel: "workbook root",
  readableLabel: "readable spreadsheet",
  listTool: "list_workbooks",
  tooLargeRecovery: "Split the workbook or read a smaller file.",
} as const satisfies Vocabulary<string>;
