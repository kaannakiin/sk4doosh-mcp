import type { Locale } from "@chat/contracts/common/locale";
import type { IntegrationTool } from "@chat/contracts/integration/tool-approval";

import { matchesQuery } from "./grouping";

export const TOOL_FILTERS = [
  "all",
  "destructive",
  "overridden",
  "stale",
] as const;

export type ToolFilter = (typeof TOOL_FILTERS)[number];

export function isToolFilter(value: unknown): value is ToolFilter {
  return TOOL_FILTERS.some((filter) => filter === value);
}

function passes(tool: IntegrationTool, filter: ToolFilter): boolean {
  return filter === "destructive"
    ? tool.destructive
    : filter === "overridden"
      ? tool.override !== "inherit"
      : filter === "stale"
        ? tool.overrideStale
        : true;
}

export function filterTools(
  tools: readonly IntegrationTool[],
  query: string,
  filter: ToolFilter,
  locale: Locale,
): readonly IntegrationTool[] {
  const needle = query.trim().toLocaleLowerCase(locale);

  return tools.filter(
    (tool) =>
      passes(tool, filter) &&
      matchesQuery([tool.name, tool.title, tool.description], needle, locale),
  );
}
