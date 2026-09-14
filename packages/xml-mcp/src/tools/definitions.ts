import {
  readOnly,
  toolNamesOf,
  type HandlersOf,
  type ToolDefinitions,
  type ToolInputOf,
  type ToolNameOf,
} from "@sk-mcp/file-core";
import { z } from "zod";

import { limits } from "../host/platform/limits.js";
import {
  address,
  caseSensitive,
  columns,
  filePath,
  itemAddress,
  match,
  namespaceBindings,
  where,
} from "./schemas.js";

export const toolDefinitions = {
  list_documents: {
    description:
      "List readable XML documents under the server root. Returns filePath values that other tools accept verbatim. The listing never parses a file, so a listed path is a candidate, not a guarantee of well-formed XML. totalExact distinguishes a complete total; scanTruncated is separate from the result page limit.",
    inputSchema: z.object({
      subdirectory: z
        .string()
        .optional()
        .describe("Folder under the root to list."),
      pattern: z
        .string()
        .optional()
        .describe("Glob over the relative path, for example build/*.csproj."),
      maxResults: z
        .int()
        .min(1)
        .max(limits.maxListResults)
        .optional()
        .describe(
          "Maximum returned files, default 50. Does not increase the traversal budget.",
        ),
    }),
    annotations: readOnly,
  },
  describe_document: {
    description:
      "Summarise one XML document: the document element, every namespace with a stable alias, a bounded structure count, repeated-element candidates and an address read_node accepts. Repetition candidates are observations, not a schema. Counts carry an exact flag; a sampled count says so.",
    inputSchema: z.object({
      filePath,
      maxPaths: z
        .int()
        .min(1)
        .max(limits.maxDescribePaths)
        .optional()
        .describe(
          "Maximum repetition candidates and mixed-content examples, default 20.",
        ),
    }),
    annotations: readOnly,
  },
  read_node: {
    description:
      "Read a bounded, ordered slice of one document as flat depth-first records. Every record carries nodeId, parentId and childIndex, so text, element, comment and processing-instruction order survives a page boundary. Values are returned as written: no trimming, no number or date conversion. An element held back by maxDepth is marked childrenOmitted and needs its own call with that address; the cursor never delivers it.",
    inputSchema: z.object({
      filePath,
      address: address.optional(),
      maxDepth: z
        .int()
        .min(0)
        .max(limits.maxDomDepth)
        .optional()
        .describe(
          "Levels below the addressed node to descend, default unlimited within the depth ceiling. 0 returns that node alone.",
        ),
      maxNodes: z
        .int()
        .min(1)
        .max(limits.maxReadNodes)
        .optional()
        .describe(
          "Maximum records in one page, default 50. The response byte budget may stop the page earlier.",
        ),
      cursor: z
        .string()
        .optional()
        .describe(
          "nextCursor from a previous read_node response. Cannot be combined with address.",
        ),
    }),
    annotations: readOnly,
  },
  find_in_document: {
    description:
      "Find literal text in one document's text nodes and attribute values. Case-sensitive and literal: the query is never treated as a regular expression or a query language. totalMatches appears only when the scan finished; a stopped scan reports scannedCount and matchedSoFar instead.",
    inputSchema: z.object({
      filePath,
      query: z
        .string()
        .min(1)
        .describe("Literal text to look for. Case-sensitive; not a pattern."),
      matchMode: z
        .enum(["contains", "exact"])
        .optional()
        .describe("Substring match (default) or whole-value equality."),
      searchIn: z
        .enum(["text", "attributes", "both"])
        .optional()
        .describe(
          "Search text nodes (default), attribute values, or both. With both, a text hit and an attribute hit on the same element are reported separately.",
        ),
      scopeAddress: address
        .optional()
        .describe("Restrict the scan to this element's subtree."),
      maxResults: z
        .int()
        .min(1)
        .max(limits.maxFindResults)
        .optional()
        .describe("Maximum matches in one page, default 50."),
      cursor: z
        .string()
        .optional()
        .describe(
          "nextCursor from a previous find_in_document response. Cannot be combined with scopeAddress.",
        ),
    }),
    annotations: readOnly,
  },
  select_xpath: {
    description:
      "Evaluate one XPath 1.0 expression against a document. The expression is passed to the engine exactly as written: no rewriting, no namespace guessing, no extension functions, and nothing from XPath 2.0 or later. resultType separates a node-set from a string, number or boolean, so an empty node-set, an empty string, false and 0 all survive as themselves; a number carries numberKind so NaN and infinity are never a silent null. Node-set members are addressed where an address exists; a prolog comment and a namespace node carry unaddressable instead. Evaluation may materialise the whole node-set, so maxResults bounds the response, not the cost.",
    inputSchema: z.object({
      filePath,
      xpath: z
        .string()
        .min(1)
        .max(limits.maxXpathChars)
        .describe("XPath 1.0 expression."),
      namespaces: namespaceBindings.optional(),
      maxResults: z
        .int()
        .min(1)
        .max(limits.maxXpathResults)
        .optional()
        .describe(
          "Maximum node-set members in one page, default 50. The response byte budget may stop the page earlier. Ignored for a string, number or boolean result.",
        ),
      cursor: z
        .string()
        .optional()
        .describe(
          "nextCursor from a previous select_xpath response. The expression is evaluated again, so continuing costs what the first call cost.",
        ),
    }),
    annotations: readOnly,
  },
  project_records: {
    description:
      "Turn a repeated element into rows and named columns. Values are returned as written: no trimming, no number or date conversion. A cell says which of four things happened: present, empty when the value exists and is the empty string, missing when the address matches nothing, and multiple when several nodes match and no policy chose one. Rows carry occurrence rather than a repeated address; a row's canonical address is itemParentAddress plus itemName at that occurrence.",
    inputSchema: z.object({
      filePath,
      itemAddress,
      columns,
      where: where.optional(),
      match,
      caseSensitive,
      maxRows: z
        .int()
        .min(1)
        .max(limits.maxRows)
        .optional()
        .describe(
          "Maximum rows in one page, default 50. The response byte budget may stop the page earlier.",
        ),
      cursor: z
        .string()
        .optional()
        .describe(
          "nextCursor from a previous project_records response. Cannot be combined with different options.",
        ),
    }),
    annotations: readOnly,
  },
  aggregate_document: {
    description:
      "Count and summarise a repeated element in one call, instead of paging the records. count needs no column and is always available. sum, avg, min and max require numericMode: binary64, which is an explicit acceptance that values become binary64 doubles: a value with more digits than that holds is refused rather than quietly changed, and values that cannot be represented exactly are counted in rounded. groupCount and matchedItems cover the whole scan even when maxGroups cuts the returned groups.",
    inputSchema: z.object({
      filePath,
      itemAddress,
      columns,
      groupBy: z
        .array(z.string().min(1))
        .max(limits.maxMetrics)
        .optional()
        .describe(
          "Labels of declared columns to group by. Omit for one whole-set total.",
        ),
      metrics: z
        .array(
          z.object({
            fn: z.enum([
              "count",
              "countValues",
              "countDistinct",
              "sum",
              "avg",
              "min",
              "max",
            ]),
            column: z
              .string()
              .min(1)
              .optional()
              .describe(
                "Label of a declared column. Required for every metric except count.",
              ),
          }),
        )
        .min(1)
        .max(limits.maxMetrics),
      where: where.optional(),
      match,
      caseSensitive,
      numericMode: z
        .enum(["off", "binary64"])
        .optional()
        .describe(
          "off (default) offers only the counting metrics. binary64 enables sum, avg, min and max with double precision.",
        ),
      orderBy: z
        .enum(["group", "metric"])
        .optional()
        .describe("Order groups by group key (default) or by one metric."),
      orderByMetric: z
        .int()
        .min(1)
        .optional()
        .describe("One-based index into metrics, default 1."),
      descending: z
        .boolean()
        .optional()
        .describe("Descending order, default false."),
      maxGroups: z
        .int()
        .min(1)
        .max(limits.maxGroups)
        .optional()
        .describe(
          "Maximum groups returned, default 50. groupCount still reports every group the scan found.",
        ),
    }),
    annotations: readOnly,
  },
} as const satisfies ToolDefinitions;

export type Definitions = typeof toolDefinitions;

export type ToolName = ToolNameOf<Definitions>;

export const toolNames: readonly ToolName[] = toolNamesOf(toolDefinitions);

export type ToolInput<K extends ToolName> = ToolInputOf<Definitions, K>;

export type ToolHandlers = HandlersOf<Definitions>;
