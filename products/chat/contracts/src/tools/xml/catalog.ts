import { describeDocumentInputSchema } from "./describe-document.ts";
import { projectRecordsInputSchema } from "./project-records.ts";
import { readNodeInputSchema } from "./read-node.ts";
import { selectXpathInputSchema } from "./select-xpath.ts";

/**
 * The XML reader's tool surface as this product exposes it, in the shape the AI
 * SDK's MCP client takes as `tools({ schemas })`.
 *
 * `find_in_document` and `aggregate_document` are left out: XPath already
 * covers literal search and `count()`/`sum()`, and the aggregate tool's column
 * declarations are the same shape `project_records` takes, so exposing both
 * doubles the surface a model has to get right for no new capability.
 */
export const XML_TOOL_SCHEMAS = {
  describe_document: { inputSchema: describeDocumentInputSchema },
  read_node: { inputSchema: readNodeInputSchema },
  select_xpath: { inputSchema: selectXpathInputSchema },
  project_records: { inputSchema: projectRecordsInputSchema },
} as const;

export type XmlToolSchemas = typeof XML_TOOL_SCHEMAS;
