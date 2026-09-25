import { z } from "zod";

export const EXCEL_TOOL_NAMES = [
  "describe_workbook",
  "read_sheet",
  "aggregate_sheet",
  "find_in_sheet",
  "list_workbooks",
  "get_tables",
  "get_data_validations",
  "get_merged_ranges",
  "get_conditional_formats",
  "get_images",
] as const;

export const XML_TOOL_NAMES = [
  "describe_document",
  "read_node",
  "select_xpath",
  "project_records",
  "find_in_document",
  "aggregate_document",
  "list_documents",
] as const;

export const PDF_TOOL_NAMES = [
  "describe_pdf",
  "read_pdf_pages",
  "find_in_pdf",
  "list_pdfs",
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
  list_workbooks: "excel",
  get_tables: "excel",
  get_data_validations: "excel",
  get_merged_ranges: "excel",
  get_conditional_formats: "excel",
  get_images: "excel",
  describe_document: "xml",
  read_node: "xml",
  select_xpath: "xml",
  project_records: "xml",
  find_in_document: "xml",
  aggregate_document: "xml",
  list_documents: "xml",
  describe_pdf: "pdf",
  read_pdf_pages: "pdf",
  find_in_pdf: "pdf",
  list_pdfs: "pdf",
  find_tools: "discovery",
  codex_task: "codex",
};
