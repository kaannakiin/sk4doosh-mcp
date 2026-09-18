import { SkMcpTemplateError } from "./errors.js";
import type {
  ArgumentCuration,
  ArgumentFill,
  EndpointDescriptor,
  ToolVariant,
} from "./generated/endpoint-descriptor.js";

export type ArgumentSlot = "parameter" | "body" | "bodyRoot";

export interface ResolvedArgument {
  readonly name: string;
  readonly slot: ArgumentSlot;
  readonly required: boolean;
  readonly argument?: string;
  readonly description?: string;
  readonly fill?: ArgumentFill;
}

/**
 * The shape curation is projected onto, decided before curation runs.
 *
 * Passing it in rather than deriving it here is what keeps curation from
 * influencing shape selection: the body-root decision and the flattening
 * predicate read wire names only.
 */
export interface CurationShape {
  readonly parameterNames: readonly string[];
  readonly bodyFieldNames: readonly string[];
  readonly bodyRoot?: string;
  readonly requiredWireNames: ReadonlySet<string>;
}

export interface ResolvedCuration {
  readonly byWireName: ReadonlyMap<string, ResolvedArgument>;
  /** Wire names the agent may never send, whatever the body allows. */
  readonly denied: ReadonlySet<string>;
  agentNameOf(wireName: string): string;
  isHidden(wireName: string): boolean;
}

const empty: ResolvedCuration = {
  byWireName: new Map(),
  denied: new Set(),
  agentNameOf: (wireName) => wireName,
  isHidden: () => false,
};

export function emptyCuration(): ResolvedCuration {
  return empty;
}

/**
 * Merges the endpoint's declarations with a variant's.
 *
 * The merge is whole-record replacement per wire name, never field by field: a
 * field-level merge means a host who omits `tenantId` from one variant leaks
 * it, which is a security-shaped silent failure. A record carrying only `name`
 * therefore resets that argument to the endpoint's own shape.
 */
function declarations(
  endpoint: EndpointDescriptor,
  variant: ToolVariant | undefined,
): ArgumentCuration[] {
  const merged = new Map<string, ArgumentCuration>();
  for (const record of endpoint.arguments ?? []) {
    if (merged.has(record.name)) {
      throw new SkMcpTemplateError(
        "duplicate_argument",
        `Argument '${record.name}' is curated twice.`,
      );
    }
    merged.set(record.name, record);
  }
  const overrides = new Map<string, ArgumentCuration>();
  for (const record of variant?.arguments ?? []) {
    if (overrides.has(record.name)) {
      throw new SkMcpTemplateError(
        "duplicate_argument",
        `Argument '${record.name}' is curated twice by variant '${variant?.name}'.`,
      );
    }
    overrides.set(record.name, record);
    merged.set(record.name, record);
  }
  return [...merged.values()];
}

function slotOf(name: string, shape: CurationShape): ArgumentSlot | undefined {
  if (shape.parameterNames.includes(name)) {
    return "parameter";
  }
  if (shape.bodyRoot !== undefined) {
    return shape.bodyRoot === name ? "bodyRoot" : undefined;
  }
  return shape.bodyFieldNames.includes(name) ? "body" : undefined;
}

/**
 * Spares a declaration that only the folded-away route could satisfy.
 *
 * Folding keeps the shortest route, and two routes of one operation can carry different path
 * parameters. Without this, which route wins a length comparison decides whether the endpoint
 * builds at all. Fail-closed still holds: the argument genuinely does not exist on the route that
 * will be invoked, so the declaration is dropped rather than applied.
 */
export interface CurationRelief {
  readonly foldedNames: ReadonlySet<string>;
  readonly onUnused: (name: string) => void;
}

/**
 * The descriptions the host wrote in its own curation declarations, after variant replacement.
 *
 * Distinct from the descriptions on the published schema, which also carry prose inherited from
 * the backend's own types. Only the host-authored half is evidence that a curated argument was
 * named while it was being curated away, so only this half is searched for a leak
 * ([argument-curation.md](../../spec/argument-curation.md)).
 */
export function curatedDescriptions(
  endpoint: EndpointDescriptor,
  variant: ToolVariant | undefined,
): readonly string[] {
  const descriptions: string[] = [];
  for (const record of declarations(endpoint, variant)) {
    if (record.description !== undefined) {
      descriptions.push(record.description);
    }
  }
  return descriptions;
}

export function resolveCuration(
  endpoint: EndpointDescriptor,
  variant: ToolVariant | undefined,
  shape: CurationShape,
  relief?: CurationRelief,
): ResolvedCuration {
  const records = declarations(endpoint, variant);
  if (records.length === 0) {
    return empty;
  }

  const byWireName = new Map<string, ResolvedArgument>();
  const denied = new Set<string>();

  for (const record of records) {
    const slot = slotOf(record.name, shape);
    if (slot === undefined) {
      if (relief?.foldedNames.has(record.name) === true) {
        relief.onUnused(record.name);
        continue;
      }
      throw new SkMcpTemplateError(
        "curation_unresolved",
        `Curation names '${record.name}', which this operation does not have. Argument names are matched exactly, including case.`,
      );
    }
    const required = shape.requiredWireNames.has(record.name);
    if (record.hidden?.kind === "omit" && required) {
      throw new SkMcpTemplateError(
        "hidden_required_omitted",
        `Argument '${record.name}' is required, so it cannot be hidden without a value.`,
      );
    }
    const resolved: ResolvedArgument = {
      name: record.name,
      slot,
      required,
      ...(record.as === undefined || record.as === record.name
        ? {}
        : { argument: record.as }),
      ...(record.description === undefined
        ? {}
        : { description: record.description }),
      ...(record.hidden === undefined ? {} : { fill: record.hidden }),
    };
    byWireName.set(record.name, resolved);
    if (resolved.argument !== undefined || resolved.fill !== undefined) {
      denied.add(record.name);
    }
  }

  assertAgentNamesUnique(byWireName, shape);

  return {
    byWireName,
    denied,
    agentNameOf: (wireName) => byWireName.get(wireName)?.argument ?? wireName,
    isHidden: (wireName) => byWireName.get(wireName)?.fill !== undefined,
  };
}

/**
 * The visible agent namespace has to stay unique, and the check cannot be the
 * wire-name one: a rename can collide with a name that is itself renamed away,
 * in which case `allowed` and `denied` would overlap and the deny-list would
 * become unstateable.
 */
function assertAgentNamesUnique(
  byWireName: ReadonlyMap<string, ResolvedArgument>,
  shape: CurationShape,
): void {
  const wireNames = [
    ...shape.parameterNames,
    ...(shape.bodyRoot === undefined ? shape.bodyFieldNames : [shape.bodyRoot]),
  ];
  const seen = new Set<string>();
  for (const wireName of wireNames) {
    const resolved = byWireName.get(wireName);
    if (resolved?.fill !== undefined) {
      continue;
    }
    const agentName = resolved?.argument ?? wireName;
    if (seen.has(agentName)) {
      throw new SkMcpTemplateError(
        "argument_collision",
        `Curation produces two arguments named '${agentName}'.`,
      );
    }
    seen.add(agentName);
  }
}

export function curationShapeOf(
  parameterNames: readonly string[],
  requiredParameterNames: readonly string[],
  bodyFieldNames: readonly string[],
  requiredBodyFieldNames: readonly string[],
  bodyRoot: string | undefined,
  bodyRootRequired: boolean,
): CurationShape {
  const requiredWireNames = new Set<string>([
    ...requiredParameterNames,
    ...(bodyRoot === undefined ? requiredBodyFieldNames : []),
  ]);
  if (bodyRoot !== undefined && bodyRootRequired) {
    requiredWireNames.add(bodyRoot);
  }
  return {
    parameterNames,
    bodyFieldNames: bodyRoot === undefined ? bodyFieldNames : [],
    ...(bodyRoot === undefined ? {} : { bodyRoot }),
    requiredWireNames,
  };
}
