import { SkMcpCatalogError } from "./errors.js";

export type SelectionDefault = "include" | "exclude";

export type SelectionMarker = "include" | "exclude" | "both";

function reject(
  marker: SelectionMarker | undefined,
  level: string,
  describedAs?: string,
): void {
  if (marker !== "both") {
    return;
  }
  const target = describedAs === undefined ? "" : ` on ${describedAs}`;
  throw new SkMcpCatalogError(
    "ambiguous_selection",
    `Both include and exclude markers are present at the ${level} level${target}; remove one of them.`,
  );
}

export function isSelected(
  defaultDecision: SelectionDefault,
  container?: SelectionMarker,
  operation?: SelectionMarker,
  describedAs?: string,
): boolean {
  reject(container, "container", describedAs);
  reject(operation, "operation", describedAs);
  if (operation !== undefined) {
    return operation === "include";
  }
  if (container !== undefined) {
    return container === "include";
  }
  return defaultDecision === "include";
}

export function combineMarkers(
  include: boolean,
  exclude: boolean,
): SelectionMarker | undefined {
  if (include && exclude) {
    return "both";
  }
  if (include) {
    return "include";
  }
  if (exclude) {
    return "exclude";
  }
  return undefined;
}
