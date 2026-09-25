import type { ReaderFamily } from "@chat/contracts/attachment/media-type";
import { EXCEL_TOOL_SCHEMAS } from "@chat/contracts/tools/excel/catalog";
import { PDF_TOOL_SCHEMAS } from "@chat/contracts/tools/pdf/catalog";
import { XML_TOOL_SCHEMAS } from "@chat/contracts/tools/xml/catalog";
import type { ToolSet } from "ai";
import type { ZodType } from "zod";

interface CatalogEntry {
  readonly inputSchema: ZodType;
  readonly serverName?: string;
  readonly description?: string;
}

type ReaderCatalog = Readonly<Record<string, CatalogEntry>>;

const CATALOG_BY_FAMILY: Readonly<Record<ReaderFamily, ReaderCatalog>> = {
  workbook: EXCEL_TOOL_SCHEMAS,
  document: XML_TOOL_SCHEMAS,
  pdf: PDF_TOOL_SCHEMAS,
};

export function serverSchemasOf(
  family: ReaderFamily,
): Record<string, { inputSchema: ZodType }> {
  return Object.fromEntries(
    Object.entries(CATALOG_BY_FAMILY[family]).map(([name, entry]) => [
      entry.serverName ?? name,
      { inputSchema: entry.inputSchema },
    ]),
  );
}

export function exposedToolsOf(family: ReaderFamily, tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(CATALOG_BY_FAMILY[family]).flatMap(([name, entry]) => {
      const tool = tools[entry.serverName ?? name];
      if (tool === undefined) {
        return [];
      }

      return [
        [
          name,
          entry.description === undefined
            ? tool
            : { ...tool, description: entry.description },
        ],
      ];
    }),
  ) as ToolSet;
}
