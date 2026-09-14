import { Inject, Injectable, RequestMethod } from "@nestjs/common";
import {
  ApplicationConfig,
  DiscoveryService,
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
  deduplicateOperations,
  isSelected,
  SkMcpCatalogError,
  SkMcpTemplateError,
  ToolIndex,
  unflattenableRootKey,
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
import { SK_MCP_OPTIONS, type SkMcpOptions } from "./options.js";
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
      try {
        if (
          isSelected(
            this.options.selection.default,
            container,
            operation,
            `${endpoint.descriptor.method} ${endpoint.descriptor.route}`,
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

    const alternates = new Map<DiscoveredEndpoint, string[]>();
    const operations = deduplicateOperations(
      chosen,
      (endpoint) => this.declared(endpoint),
      ({ kept, folded }) => {
        const routes = folded.map((endpoint) => endpoint.descriptor.route);
        alternates.set(kept, routes);
        report({
          code: "route_folded",
          message: `${kept.controller.name}.${kept.handlerName} is also mounted at ${routes.join(", ")}; one tool is produced and ${kept.descriptor.route} is the route it invokes.`,
        });
      },
    );

    let names: string[];
    try {
      names = createToolNames(
        operations.map((endpoint) => this.declared(endpoint)),
        {
          prefixMode: this.options.naming.prefixMode,
          onDiagnostic: (code, message) => report({ code, message }),
        },
      );
    } catch (error) {
      report({
        code: (error as SkMcpCatalogError).code,
        message: (error as Error).message,
      });
      names = [];
    }

    const entries: CatalogEntry[] = [];
    const byName = new Map<string, CatalogEntry>();
    for (const [position, endpoint] of operations.entries()) {
      const name = names[position];
      if (name === undefined) {
        continue;
      }
      const descriptor = this.declared(endpoint);
      if (name.length > 64) {
        report({
          code: "long_tool_name",
          message: `Tool name '${name}' is ${String(name.length)} characters; long names cost agent context and weaken search.`,
        });
      }
      reportBodyRoot(descriptor, report);
      let tool: ToolDefinition;
      let template: RequestTemplate | undefined;
      try {
        tool = createToolDefinition(descriptor, name);
        template = createRequestTemplateFromEndpoint(descriptor);
      } catch (error) {
        const code =
          error instanceof SkMcpTemplateError
            ? error.code
            : "template_rejected";
        report({ code, message: (error as Error).message });
        continue;
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

  private declared(endpoint: DiscoveredEndpoint): EndpointDescriptor {
    const hints = endpoint.hints;
    return {
      ...endpoint.descriptor,
      ...(hints.name === undefined ? {} : { toolName: hints.name }),
      ...(hints.prefix === undefined ? {} : { containerPrefix: hints.prefix }),
    };
  }
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
