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

export const PDF_TOOL_NAMES = [
  "describe_pdf",
  "read_pdf_pages",
  "find_in_pdf",
] as const;

export const DISCOVERY_TOOL_NAMES = ["find_tools"] as const;

export const CODEX_TOOL_NAMES = ["codex_task"] as const;

export const chatToolNameSchema = z.enum([
  ...EXCEL_TOOL_NAMES,
  ...XML_TOOL_NAMES,
  ...PDF_TOOL_NAMES,
  ...DISCOVERY_TOOL_NAMES,
  ...CODEX_TOOL_NAMES,
]);

export type ChatToolName = z.infer<typeof chatToolNameSchema>;

export function isChatToolName(value: unknown): value is ChatToolName {
  return chatToolNameSchema.safeParse(value).success;
}

export const CHAT_TOOL_FAMILIES = [
  "excel",
  "xml",
  "pdf",
  "discovery",
  "codex",
] as const;

export type ChatToolFamily = (typeof CHAT_TOOL_FAMILIES)[number];

/**
 * Guard: a total `Record`, so a tool added to `ChatToolName` without a family
 * fails the build instead of landing in whichever group a fallback names.
 */
export const CHAT_TOOL_FAMILY: Record<ChatToolName, ChatToolFamily> = {
  describe_workbook: "excel",
  read_sheet: "excel",
  aggregate_sheet: "excel",
  find_in_sheet: "excel",
  describe_document: "xml",
  read_node: "xml",
  select_xpath: "xml",
  project_records: "xml",
  describe_pdf: "pdf",
  read_pdf_pages: "pdf",
  find_in_pdf: "pdf",
  find_tools: "discovery",
  codex_task: "codex",
};
