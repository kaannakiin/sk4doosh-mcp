import { SkMcpCatalogError } from "./errors.js";
import { matchesRoute } from "./route-glob.js";

export type SelectionDecision = "include" | "exclude";

export type SelectionDefault = SelectionDecision;

export type SelectionMarker = "include" | "exclude" | "both";

export interface SelectionRule {
  readonly route?: string;
  readonly method?: string;
  readonly decision: SelectionDecision;
}

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

function specificityOf(rule: SelectionRule): number {
  return (
    (rule.route === undefined ? 0 : 1) + (rule.method === undefined ? 0 : 1)
  );
}

function matchesEndpoint(
  rule: SelectionRule,
  route: string,
  method: string,
): boolean {
  if (rule.route !== undefined && !matchesRoute(rule.route, route)) {
    return false;
  }
  return (
    rule.method === undefined ||
    rule.method.toUpperCase() === method.toUpperCase()
  );
}

/**
 * Folds the host's config-level rules into one marker for an endpoint.
 *
 * @param rules - The host's declared rules, in any order; order carries no meaning.
 * @param route - The endpoint's composed route template.
 * @param method - The endpoint's HTTP method.
 * @param describedAs - How to name the endpoint in an error.
 * @returns The decision of the most specific matching rules, or `undefined` when none match.
 * @throws SkMcpCatalogError `ambiguous_selection` when equally specific rules disagree.
 */
export function resolveRules(
  rules: readonly SelectionRule[] | undefined,
  route: string,
  method: string,
  describedAs?: string,
): SelectionMarker | undefined {
  const matching = (rules ?? []).filter((rule) =>
    matchesEndpoint(rule, route, method),
  );
  if (matching.length === 0) {
    return undefined;
  }
  const sharpest = Math.max(...matching.map(specificityOf));
  const decisions = new Set(
    matching
      .filter((rule) => specificityOf(rule) === sharpest)
      .map((rule) => rule.decision),
  );
  /**
   * Repetition is not a conflict, contradiction is: two rules that decide the same way may
   * overlap freely, which is what lets independent rules cover one endpoint. Silent resolution
   * between rules that disagree is what this forbids.
   */
  if (decisions.size > 1) {
    const target = describedAs === undefined ? "" : ` on ${describedAs}`;
    throw new SkMcpCatalogError(
      "ambiguous_selection",
      `Two selection rules of equal specificity disagree${target}; narrow one of their targets.`,
    );
  }
  return [...decisions][0];
}

export function isSelected(
  defaultDecision: SelectionDefault,
  container?: SelectionMarker,
  operation?: SelectionMarker,
  describedAs?: string,
  rule?: SelectionMarker,
): boolean {
  reject(container, "container", describedAs);
  reject(operation, "operation", describedAs);
  if (operation !== undefined) {
    return operation === "include";
  }
  if (container !== undefined) {
    return container === "include";
  }
  if (rule !== undefined) {
    return rule === "include";
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
