import { z } from "zod";

export const EXCEL_TOOL_NAMES = [
  "describe_workbook",
  "read_sheet",
  "aggregate_sheet",
  "find_in_sheet",
] as const;

export const XML_TOOL_NAMES = [
  "describe_document",
  "read_node",
  "select_xpath",
  "project_records",
] as const;

export const chatToolNameSchema = z.enum([
  ...EXCEL_TOOL_NAMES,
  ...XML_TOOL_NAMES,
]);

export type ChatToolName = z.infer<typeof chatToolNameSchema>;

export function isChatToolName(value: unknown): value is ChatToolName {
  return chatToolNameSchema.safeParse(value).success;
}
