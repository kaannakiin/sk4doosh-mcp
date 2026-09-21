import { Inject, Injectable, Optional, RequestMethod } from "@nestjs/common";
import {
  ApplicationConfig,
  DiscoveryService,
  HttpAdapterHost,
  ModulesContainer,
} from "@nestjs/core";
import {
  bodyRootArgument,
  bodyRootReasonOf,
  collidingBodyField,
  combineMarkers,
  createRequestTemplateFromEndpoint,
  createToolDefinition,
  createToolNames,
  curatedDescriptions,
  deduplicateOperations,
  expandToolProductions,
  foldToken,
  isSelected,
  matchesRoute,
  resolveRules,
  routePlaceholderNames,
  searchParameters,
  SkMcpCatalogError,
  SkMcpTemplateError,
  tokenize,
  ToolIndex,
  unflattenableRootKey,
  type ArgumentCuration,
  type CurationRelief,
  type EndpointDescriptor,
  type RequestTemplate,
  type ToolDefinition,
} from "@sk-mcp/core";
import {
  atLeast,
  severityOf,
  type CatalogDiagnostic,
} from "./discovery/diagnostics.js";
import {
  createRoutePaths,
  discoverEndpoints,
  modulePathOf,
  normalizeRoute,
  type DiscoveredEndpoint,
} from "./discovery/endpoint-discovery.js";
import type { ArgumentRule } from "./decorators.js";
import {
  SK_MCP_OPTIONS,
  type CurationRule,
  type SkMcpOptions,
} from "./options.js";
import { protectedResourceMetadataPath } from "./transport/protected-resource-metadata.js";

export interface CatalogEntry {
  readonly tool: ToolDefinition;
  readonly descriptor: EndpointDescriptor;
  readonly controller: NewableFunction;
  readonly handlerName: string;
  readonly template?: RequestTemplate;
  readonly alternateRoutes?: readonly string[];
}

export interface CatalogSnapshot {
  readonly entries: readonly CatalogEntry[];
  readonly byName: ReadonlyMap<string, CatalogEntry>;
  readonly index: ToolIndex;
  readonly diagnostics: readonly CatalogDiagnostic[];
  readonly fatal: readonly CatalogDiagnostic[];
  readonly policyNames: ReadonlySet<string>;
  readonly discovered: number;
  readonly selected: number;
}

const groupedParametersOf = (
  descriptor: EndpointDescriptor,
): ReadonlySet<string> =>
  new Set(
    (descriptor.parameters ?? [])
      .filter((parameter) => parameter.style === "deepObject")
      .map((parameter) => parameter.name),
  );

@Injectable()
export class SkMcpCatalog {
  private snapshot: CatalogSnapshot | undefined;
  private currentGeneration = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly modules: ModulesContainer,
    private readonly applicationConfig: ApplicationConfig,
    @Inject(SK_MCP_OPTIONS) private readonly options: SkMcpOptions,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {}

  get generation(): number {
    return this.currentGeneration;
  }

  get current(): CatalogSnapshot {
    this.snapshot ??= this.build();
    return this.snapshot;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reload(): void {
    this.snapshot = this.build();
    this.currentGeneration += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  get diagnostics(): readonly CatalogDiagnostic[] {
    return this.current.diagnostics;
  }

  find(name: string): CatalogEntry | undefined {
    return this.current.byName.get(name);
  }

  ensureValid(): void {
    const fatal = this.current.fatal;
    if (fatal.length === 0) {
      return;
    }
    throw new SkMcpCatalogError(
      fatal[0]?.code as "name_collision",
      fatal.map((diagnostic) => diagnostic.message).join(" | "),
    );
  }

  /**
   * Guard: Express 5 defaults `query parser` to `simple`, which does not parse
   * brackets — `?filter[status]=x` then arrives as one literal key and the DTO
   * binds nothing. A tool that composes a filter the backend silently ignores
   * returns an unfiltered result set, which is the failure
   * `unresolved_query_shape` exists to prevent, so this is fatal rather than a
   * warning. Only Express is checked: `getInstance().get` is a route
   * registrar on Fastify, not a settings reader.
   */
  private reportUnparsedBrackets(
    entries: readonly CatalogEntry[],
    report: (diagnostic: CatalogDiagnostic) => void,
  ): void {
    const bracketed = entries.filter((entry) =>
      (entry.descriptor.parameters ?? []).some(
        (parameter) =>
          parameter.style === "deepObject" &&
          (parameter.objectNotation ?? "bracket") === "bracket",
      ),
    );
    if (bracketed.length === 0) {
      return;
    }
    const adapter = this.adapterHost?.httpAdapter;
    if (adapter === undefined || adapter.getType() !== "express") {
      return;
    }
    const instance = adapter.getInstance<{ get(name: string): unknown }>();
    const parser: unknown = instance.get("query parser");
    if (parser === "extended" || typeof parser === "function") {
      return;
    }
    report({
      code: "query_parser_not_extended",
      message: `Tool '${bracketed[0]?.tool.name}' composes a bracketed query object, but this application's Express 'query parser' is '${String(parser)}', which delivers one literal key instead of an object. Call app.set('query parser', 'extended'), or declare objectNotation on the parameter.`,
    });
  }

  private build(): CatalogSnapshot {
    const diagnostics: CatalogDiagnostic[] = [];
    const report = (diagnostic: CatalogDiagnostic): void => {
      diagnostics.push(diagnostic);
    };

    const routePaths = createRoutePaths(this.applicationConfig);
    const globalPrefix = this.applicationConfig.getGlobalPrefix();
    const versioningOptions = this.applicationConfig.getVersioning();
    const mcpPath = this.options.resourceServer?.mcpPath ?? "/mcp";
    this.checkMetadataPath(globalPrefix, mcpPath, routePaths, report);

    const applicationId = this.modules.applicationId;
    const controllers = this.discovery
      .getControllers()
      .filter((wrapper) => typeof wrapper.metatype === "function")
      .map((wrapper) => {
        const modulePath = modulePathOf(wrapper.host?.metatype, applicationId);
        return {
          metatype: wrapper.metatype as NewableFunction,
          ...(modulePath === undefined ? {} : { modulePath }),
        };
      });

    const discovered = discoverEndpoints(controllers, {
      ...(this.options.schema === undefined
        ? {}
        : { schema: this.options.schema }),
      ...(versioningOptions === undefined ? {} : { versioningOptions }),
      globalPrefix,
      routePaths,
      severity: (code) => severityOf(code, this.options.diagnostics),
      queryGrouping: this.options.query.grouping,
      report,
    });

    const reserved = routePaths
      .create({ globalPrefix, methodPath: mcpPath }, RequestMethod.ALL)
      .map(normalizeRoute);
    const routed = discovered.filter(
      (endpoint) =>
        !reserved.some((path) => endpoint.descriptor.route.startsWith(path)),
    );

    const chosen: DiscoveredEndpoint[] = [];
    for (const endpoint of routed) {
      const container = combineMarkers(
        endpoint.containerMarkers.includes(true),
        endpoint.containerMarkers.includes(false),
      );
      const operation = combineMarkers(
        endpoint.operationMarkers.includes(true),
        endpoint.operationMarkers.includes(false),
      );
      const describedAs = `${endpoint.descriptor.method} ${endpoint.descriptor.route}`;
      try {
        if (
          isSelected(
            this.options.selection.default,
            container,
            operation,
            describedAs,
            resolveRules(
              this.options.selection.rules,
              endpoint.descriptor.route,
              endpoint.descriptor.method,
              describedAs,
            ),
          )
        ) {
          chosen.push(endpoint);
        }
      } catch (error) {
        report({
          code: (error as SkMcpCatalogError).code,
          message: (error as Error).message,
        });
      }
    }

    const tagsOf = new Map<DiscoveredEndpoint, readonly string[]>();
    for (const endpoint of chosen) {
      const tags = this.tagsFor(endpoint, report);
      if (tags !== undefined) {
        tagsOf.set(endpoint, tags);
      }
    }

    const alternates = new Map<DiscoveredEndpoint, string[]>();
    const operations = deduplicateOperations(
      chosen,
      (endpoint) => this.declared(endpoint, tagsOf.get(endpoint)),
      ({ kept, folded }) => {
        const routes = folded.map((endpoint) => endpoint.descriptor.route);
        alternates.set(kept, routes);
        report({
          code: "route_folded",
          message: `${kept.controller.name}.${kept.handlerName} is also mounted at ${routes.join(", ")}; one tool is produced and ${kept.descriptor.route} is the route it invokes.`,
        });
      },
    );

    /**
     * One production per tool, from an already-folded list.
     *
     * Naming expands variants internally, so the catalog has to walk the same productions rather
     * than the operations: with variants the two lists differ in length and a positional zip over
     * operations would attach the wrong name to the wrong tool.
     */
    const declaredList = operations.map((endpoint) =>
      this.declared(endpoint, tagsOf.get(endpoint)),
    );
    const sourceOf = new Map<EndpointDescriptor, DiscoveredEndpoint>();
    operations.forEach((endpoint, index) => {
      const declared = declaredList[index];
      if (declared !== undefined) {
        sourceOf.set(declared, endpoint);
      }
    });

    let names: string[];
    let productions: ReturnType<typeof expandToolProductions>;
    try {
      productions = expandToolProductions(declaredList, (e) => e);
      names = createToolNames(declaredList, {
        prefixMode: this.options.naming.prefixMode,
        onDiagnostic: (code, message) => report({ code, message }),
      });
    } catch (error) {
      report({
        code: (error as SkMcpCatalogError).code,
        message: (error as Error).message,
      });
      productions = [];
      names = [];
    }

    const entries: CatalogEntry[] = [];
    const byName = new Map<string, CatalogEntry>();
    for (const [position, production] of productions.entries()) {
      const name = names[position];
      const endpoint = sourceOf.get(production.endpoint);
      if (name === undefined || endpoint === undefined) {
        continue;
      }
      const descriptor = production.endpoint;
      const variant = production.variant;
      if (name.length > 64) {
        report({
          code: "long_tool_name",
          message: `Tool name '${name}' is ${String(name.length)} characters; long names cost agent context and weaken search.`,
        });
      }
      reportBodyRoot(descriptor, report);
      const relief = reliefFor(descriptor, alternates.get(endpoint), report);
      let tool: ToolDefinition;
      let template: RequestTemplate | undefined;
      try {
        tool = createToolDefinition(descriptor, name, variant, relief);
        template = createRequestTemplateFromEndpoint(
          descriptor,
          variant,
          relief,
        );
      } catch (error) {
        const code =
          error instanceof SkMcpTemplateError
            ? error.code
            : "template_rejected";
        report({ code, message: (error as Error).message });
        continue;
      }
      const missing = missingFillSource(template, this.options);
      if (missing !== undefined) {
        report({
          code: "unknown_fill_source",
          message: `Tool '${name}' fills an argument from source '${missing}', which no value provider is registered for; register it with options.arguments.provide.`,
        });
        continue;
      }
      reportCurationLeaks(
        tool,
        template,
        curatedDescriptions(descriptor, variant),
        report,
      );
      if (
        template.bodyAllowsAdditionalProperties &&
        (template.bodyFills?.size ?? 0) > 0
      ) {
        report({
          code: "curated_open_body",
          message: `Tool '${name}' hides an argument on a body that accepts additional properties; the schema cannot express the exclusion, so only the composer enforces it.`,
        });
      }
      const alternateRoutes = alternates.get(endpoint);
      const entry: CatalogEntry = {
        tool,
        descriptor,
        controller: endpoint.controller,
        handlerName: endpoint.handlerName,
        ...(template === undefined ? {} : { template }),
        ...(alternateRoutes === undefined ? {} : { alternateRoutes }),
      };
      entries.push(entry);
      byName.set(name, entry);
    }

    this.reportUnparsedBrackets(entries, report);

    const policyNames = new Set<string>();
    for (const entry of entries) {
      for (const policy of entry.descriptor.auth.policies) {
        policyNames.add(policy);
      }
    }

    const failOn = this.options.diagnostics.failOn ?? "fatal";
    const fatal = diagnostics.filter((diagnostic) =>
      atLeast(severityOf(diagnostic.code, this.options.diagnostics), failOn),
    );

    reportIndistinguishableVariants(entries, report);

    return {
      entries,
      byName,
      index: new ToolIndex(
        entries.map((entry) => ({
          name: entry.tool.name,
          ...(entry.tool.description === undefined
            ? {}
            : { description: entry.tool.description }),
          ...(entry.descriptor.tags === undefined
            ? {}
            : { tags: entry.descriptor.tags }),
          route: entry.descriptor.route,
          ...(entry.alternateRoutes === undefined
            ? {}
            : { alternateRoutes: entry.alternateRoutes }),
          parameters: searchParameters(
            entry.tool.inputSchema,
            groupedParametersOf(entry.descriptor),
          ),
        })),
      ),
      diagnostics,
      fatal,
      policyNames,
      discovered: discovered.length,
      selected: chosen.length,
    };
  }

  private checkMetadataPath(
    globalPrefix: string,
    mcpPath: string,
    routePaths: ReturnType<typeof createRoutePaths>,
    report: (diagnostic: CatalogDiagnostic) => void,
  ): void {
    if (this.options.resourceServer === undefined || globalPrefix === "") {
      return;
    }
    const metadataPath = protectedResourceMetadataPath(mcpPath);
    const [served] = routePaths.create(
      { globalPrefix, methodPath: metadataPath },
      RequestMethod.GET,
    );
    if (served === metadataPath) {
      return;
    }
    report({
      code: "prm_path_prefixed",
      message: `The global prefix moves the protected-resource metadata to '${String(served)}', but RFC 9728 requires it at '${metadataPath}'; clients cannot discover the authorization server. Pass it to setGlobalPrefix's exclude list: setGlobalPrefix('${globalPrefix}', { exclude: ['${metadataPath}'] }).`,
    });
  }

  private declared(
    endpoint: DiscoveredEndpoint,
    tags: readonly string[] | undefined,
  ): EndpointDescriptor {
    return declaredDescriptor(endpoint, this.curationFor(endpoint), tags);
  }

  /**
   * Resolves the tag ladder: an operation or container declaration, else the host rule, else the
   * container-derived tag discovery already wrote. A declaration replaces that derived tag; it does
   * not add to it, so a host can remove a grouping it did not choose.
   */
  private tagsFor(
    endpoint: DiscoveredEndpoint,
    report: (diagnostic: CatalogDiagnostic) => void,
  ): readonly string[] | undefined {
    const declared =
      endpoint.hints.tags ?? this.options.tags?.(endpoint.controller.name);
    return declared === undefined
      ? undefined
      : cleanTags(
          declared,
          `${endpoint.controller.name}.${endpoint.handlerName}`,
          report,
        );
  }

  /**
   * Applies the declaration ladder, least specific first, with sealed fields last.
   *
   * Merging is per argument and per field, so a global rule that hides a tenant identifier and a
   * method-level rule that renames a page number both survive. A decorator wins a tie against a
   * central rule of the same specificity: it is nearer the code and that is the reading a
   * maintainer expects.
   */
  private curationFor(endpoint: DiscoveredEndpoint): ArgumentCuration[] {
    const central = this.options.arguments.rules
      .filter((rule) => matchesTarget(rule, endpoint))
      .sort((a, b) => a.specificity - b.specificity);
    assertUnambiguous(central, endpoint);
    const layers: Array<{
      readonly rules: Readonly<Record<string, ArgumentRule>>;
      readonly sealed: boolean;
    }> = [
      ...central.filter((rule) => !rule.sealed),
      { rules: endpoint.hints.arguments ?? {}, sealed: false },
      ...central.filter((rule) => rule.sealed),
    ];

    /**
     * Collected before the merge, not during it: sealed rules are applied last so that they win,
     * which means a check that learns the sealed names as it goes can never see an override.
     */
    const sealed = new Set(
      central
        .filter((rule) => rule.sealed)
        .flatMap((rule) => Object.keys(rule.rules)),
    );

    const merged = new Map<string, ArgumentRule>();
    for (const layer of layers) {
      for (const [name, rule] of Object.entries(layer.rules)) {
        if (sealed.has(name) && !layer.sealed) {
          throw new SkMcpTemplateError(
            "sealed_curation_overridden",
            `Argument '${name}' is sealed on ${endpoint.controller.name}.${endpoint.handlerName}; a sealed rule cannot be overridden.`,
          );
        }
        merged.set(name, rule);
      }
    }
    return toCuration(Object.fromEntries(merged));
  }
}

/**
 * Spares a declaration that only a folded-away route could satisfy.
 *
 * Folding keeps the shortest route, so which route wins a length comparison would otherwise decide
 * whether the endpoint builds at all. Only path parameters can differ between an operation's
 * routes, so the folded routes' placeholders are the whole vocabulary this has to consider.
 *
 * The same relief is handed to both consumers, so a name reaches the reporter twice; the set keeps
 * one warning per name.
 */
function reliefFor(
  descriptor: EndpointDescriptor,
  foldedRoutes: readonly string[] | undefined,
  report: (diagnostic: CatalogDiagnostic) => void,
): CurationRelief | undefined {
  if (foldedRoutes === undefined || foldedRoutes.length === 0) {
    return undefined;
  }
  const foldedNames = new Set<string>();
  for (const route of foldedRoutes) {
    for (const name of routePlaceholderNames(route)) {
      foldedNames.add(name);
    }
  }
  for (const name of routePlaceholderNames(descriptor.route)) {
    foldedNames.delete(name);
  }
  if (foldedNames.size === 0) {
    return undefined;
  }
  const reported = new Set<string>();
  return {
    foldedNames,
    onUnused: (name) => {
      if (reported.has(name)) {
        return;
      }
      reported.add(name);
      report({
        code: "curation_unused_on_kept_route",
        message: `Curation names '${name}', which exists only on a route folded away from ${descriptor.method} ${descriptor.route}; the declaration has no effect on the route that is invoked.`,
      });
    },
  };
}

/**
 * Rejects two central rules that set the same argument differently at the same specificity.
 *
 * Between levels the nearer rule simply wins, silently and by design. Within one level there is no
 * nearer rule, so a merge would have to pick by registration order and the host would be reading a
 * ladder that does not decide anything.
 */
function assertUnambiguous(
  rules: readonly CurationRule[],
  endpoint: DiscoveredEndpoint,
): void {
  const claimed = new Map<string, string>();
  for (const rule of rules) {
    for (const [name, declaration] of Object.entries(rule.rules)) {
      const key = `${rule.specificity}|${rule.sealed ? "sealed" : "open"}|${name}`;
      const written = JSON.stringify(declaration);
      const existing = claimed.get(key);
      if (existing !== undefined && existing !== written) {
        throw new SkMcpTemplateError(
          "ambiguous_curation",
          `Two curation rules of equal specificity declare argument '${name}' differently on ${endpoint.controller.name}.${endpoint.handlerName}; narrow one of their targets.`,
        );
      }
      claimed.set(key, written);
    }
  }
}

/**
 * A declared source with no provider is a build error, never a per-call one.
 *
 * Deferring it to invoke time turns a host mistake into a failure that recurs on every call and
 * that nobody in the request path can act on.
 */
function missingFillSource(
  template: RequestTemplate,
  options: SkMcpOptions,
): string | undefined {
  const fills = [
    ...template.parameters.map((parameter) => parameter.fill),
    ...(template.bodyFills?.values() ?? []),
    template.rootFill,
  ];
  for (const fill of fills) {
    if (
      fill?.kind === "deferred" &&
      typeof fill.source === "string" &&
      !options.arguments.providers.has(fill.source)
    ) {
      return fill.source;
    }
  }
  return undefined;
}

/**
 * Warns when the published prose still names an argument the agent cannot reach.
 *
 * Two codes, because the two haystacks deserve separate severities: the tool's own name and
 * description, and the descriptions the host wrote in its curation declarations. Descriptions
 * inherited from the backend's types are deliberately not searched — the host did not write them
 * while curating, and a generic wire name such as `type` collides with ordinary schema prose often
 * enough to drown the signal.
 *
 * Heuristic by construction: a single-token wire name such as `page` fires on "page size". Both
 * codes are warnings for that reason and are not escalated by default.
 */
function reportCurationLeaks(
  tool: ToolDefinition,
  template: RequestTemplate,
  descriptions: readonly string[],
  report: (diagnostic: CatalogDiagnostic) => void,
): void {
  const curated = [
    ...template.parameters
      .filter(
        (parameter) =>
          parameter.fill !== undefined || parameter.argument !== undefined,
      )
      .map((parameter) => parameter.name),
    ...(template.bodyAliases?.values() ?? []),
    ...(template.bodyFills?.keys() ?? []),
  ];
  if (curated.length === 0) {
    return;
  }
  const haystack = tokenize(`${tool.name} ${tool.description}`);
  const curatedProse = descriptions.map((description) => tokenize(description));
  for (const wireName of curated) {
    const needle = tokenize(wireName);
    if (needle.length === 0) {
      continue;
    }
    if (containsSequence(haystack, needle)) {
      report({
        code: "curation_leaks_name",
        message: `Tool '${tool.name}' still names the curated argument '${wireName}' in its name or description; the agent cannot act on it.`,
      });
    }
    if (curatedProse.some((prose) => containsSequence(prose, needle))) {
      report({
        code: "curation_leaks_name_in_argument",
        message: `Tool '${tool.name}' still names the curated argument '${wireName}' in a curated argument description; the agent can search for it but cannot act on it.`,
      });
    }
  }
}

function containsSequence(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) {
      return true;
    }
  }
  return false;
}

/**
 * Warns when two variants of one operation are the same tool twice.
 *
 * Equal schemas and equal descriptions mean two cards competing for the same terms on the same
 * route, which is the search pollution route folding already exists to prevent.
 */
function reportIndistinguishableVariants(
  entries: readonly CatalogEntry[],
  report: (diagnostic: CatalogDiagnostic) => void,
): void {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const key = `${entry.controller.name}.${entry.handlerName}|${entry.tool.description}|${JSON.stringify(entry.tool.inputSchema)}`;
    const owner = seen.get(key);
    if (owner !== undefined) {
      report({
        code: "variant_indistinguishable",
        message: `Tools '${owner}' and '${entry.tool.name}' expose the same schema and the same description; make their first clauses differ or the search card cannot tell them apart.`,
      });
      continue;
    }
    seen.set(key, entry.tool.name);
  }
}

/**
 * Folds the decorator's declarations into the descriptor.
 *
 * Discovery reports facts; declarations are reduced here, the same way `toolName` and
 * `containerPrefix` are. The curation list arrives resolved because the ladder that produces it
 * needs the host's central rules, which are not a property of the endpoint.
 */
/**
 * Drops the tags that cannot survive folding: one that folds to nothing can never be matched, and
 * two that fold alike are one filter key but two index contributions, which doubles that term's
 * search weight for what looks like a spelling choice. The host's own spelling is kept.
 */
export function cleanTags(
  declared: readonly string[],
  owner: string,
  report: (diagnostic: CatalogDiagnostic) => void,
): readonly string[] {
  const kept = new Map<string, string>();
  for (const tag of declared) {
    const folded = foldToken(tag);
    if (folded === "") {
      report({
        code: "empty_tag",
        message: `${owner} declares a tag that is empty once folded; no caller can ask for it, so it was dropped.`,
      });
      continue;
    }
    const first = kept.get(folded);
    if (first !== undefined) {
      report({
        code: "duplicate_tag",
        message: `${owner} declares '${tag}' and '${first}', which fold to the same tag; the later one was dropped because two equal tags double that term's search weight.`,
      });
      continue;
    }
    kept.set(folded, tag);
  }
  return [...kept.values()];
}

export function declaredDescriptor(
  endpoint: DiscoveredEndpoint,
  curation: readonly ArgumentCuration[],
  tags?: readonly string[],
): EndpointDescriptor {
  const hints = endpoint.hints;
  return {
    ...endpoint.descriptor,
    ...(hints.name === undefined ? {} : { toolName: hints.name }),
    ...(hints.prefix === undefined ? {} : { containerPrefix: hints.prefix }),
    ...(tags === undefined ? {} : { tags: [...tags] }),
    ...(curation.length === 0 ? {} : { arguments: [...curation] }),
    ...(hints.variants === undefined || hints.variants.length === 0
      ? {}
      : {
          variants: hints.variants.map((variant) => ({
            name: variant.name,
            description: variant.description,
            ...(variant.arguments === undefined
              ? {}
              : { arguments: toCuration(variant.arguments) }),
          })) as EndpointDescriptor["variants"],
        }),
  };
}

export function toCuration(
  rules: Readonly<Record<string, ArgumentRule>>,
): ArgumentCuration[] {
  return Object.entries(rules).map(([name, rule]) => ({
    name,
    ...(rule.hide === undefined
      ? {
          ...(rule.as === undefined ? {} : { as: rule.as }),
          ...(rule.description === undefined
            ? {}
            : { description: rule.description }),
        }
      : { hidden: rule.hide }),
  }));
}

function matchesTarget(
  rule: CurationRule,
  endpoint: DiscoveredEndpoint,
): boolean {
  const target = rule.target;
  if (
    target.controller !== undefined &&
    target.controller !== endpoint.controller
  ) {
    return false;
  }
  if (target.handler !== undefined && target.handler !== endpoint.handlerName) {
    return false;
  }
  if (
    target.method !== undefined &&
    target.method.toUpperCase() !== endpoint.descriptor.method
  ) {
    return false;
  }
  if (
    target.route !== undefined &&
    !matchesRoute(target.route, endpoint.descriptor.route)
  ) {
    return false;
  }
  return true;
}

function reportBodyRoot(
  descriptor: EndpointDescriptor,
  report: (diagnostic: CatalogDiagnostic) => void,
): void {
  const body = descriptor.requestBody;
  const parameterNames = (descriptor.parameters ?? []).map(
    (parameter) => parameter.name,
  );
  const reason = bodyRootReasonOf(body?.schema, body?.required, parameterNames);
  if (reason === undefined || body === undefined) {
    return;
  }
  const where = `${descriptor.method} ${descriptor.route}`;
  if (reason === "optional") {
    report({
      code: "optional_body_argument",
      message: `${where} binds an optional request body; it is exposed as a single optional '${bodyRootArgument}' argument, so omitting it sends no body at all.`,
    });
    return;
  }
  if (reason === "non_object") {
    report({
      code: "synthetic_body_argument",
      message: `${where} binds a request body that is not a JSON object; it is exposed as a single '${bodyRootArgument}' argument whose value becomes the whole body.`,
    });
    return;
  }
  if (reason === "collision") {
    const field = collidingBodyField(body.schema, parameterNames);
    report({
      code: "body_field_collision",
      message: `${where} binds a request body whose field '${field}' collides with a parameter of the same name; it is exposed as a single '${bodyRootArgument}' argument so neither slot is guessed.`,
    });
    return;
  }
  const key = unflattenableRootKey(body.schema) ?? "no flattenable member";
  report({
    code: "unflattenable_body_root",
    message: `${where} binds a request body whose root carries '${key}', which flattening would discard; it is exposed as a single '${bodyRootArgument}' argument that keeps the body schema whole.`,
  });
}
