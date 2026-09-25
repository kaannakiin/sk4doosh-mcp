import { aggregateDocumentInputSchema } from "./aggregate-document.ts";
import { describeDocumentInputSchema } from "./describe-document.ts";
import { findInDocumentInputSchema } from "./find-in-document.ts";
import { listDocumentsInputSchema } from "./list-documents.ts";
import { projectRecordsInputSchema } from "./project-records.ts";
import { readNodeInputSchema } from "./read-node.ts";
import { selectXpathInputSchema } from "./select-xpath.ts";

/**
 * The XML reader's tool surface as this product exposes it, in the shape the AI
 * SDK's MCP client takes as `tools({ schemas })`.
 */
export const XML_TOOL_SCHEMAS = {
  describe_document: { inputSchema: describeDocumentInputSchema },
  read_node: { inputSchema: readNodeInputSchema },
  select_xpath: { inputSchema: selectXpathInputSchema },
  project_records: { inputSchema: projectRecordsInputSchema },
  find_in_document: { inputSchema: findInDocumentInputSchema },
  aggregate_document: { inputSchema: aggregateDocumentInputSchema },
  list_documents: { inputSchema: listDocumentsInputSchema },
} as const;

export type XmlToolSchemas = typeof XML_TOOL_SCHEMAS;
