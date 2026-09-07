import { Inject, Injectable } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import {
  combineMarkers,
  createRequestTemplateFromEndpoint,
  createToolDefinition,
  createToolNames,
  deduplicateOperations,
  isSelected,
  SkMcpCatalogError,
  SkMcpTemplateError,
  ToolIndex,
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
  discoverEndpoints,
  type DiscoveredEndpoint,
} from "./discovery/endpoint-discovery.js";
import { SK_MCP_OPTIONS, type SkMcpOptions } from "./options.js";

export interface CatalogEntry {
  readonly tool: ToolDefinition;
  readonly descriptor: EndpointDescriptor;
  readonly controller: NewableFunction;
  readonly handlerName: string;
  readonly template?: RequestTemplate;
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

    const controllers = this.discovery
      .getControllers()
      .filter((wrapper) => typeof wrapper.metatype === "function")
      .map((wrapper) => ({ metatype: wrapper.metatype as NewableFunction }));

    const discovered = discoverEndpoints(controllers, {
      ...(this.options.schema === undefined
        ? {}
        : { schema: this.options.schema }),
      report,
    });

    const reserved = this.options.resourceServer?.mcpPath ?? "/mcp";
    const routed = discovered.filter(
      (endpoint) => !endpoint.descriptor.route.startsWith(reserved),
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

    const operations = deduplicateOperations(
      chosen,
      (endpoint) => this.declared(endpoint),
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
      let tool: ToolDefinition;
      let template: RequestTemplate | undefined;
      try {
        tool = createToolDefinition(descriptor, name);
        template = createRequestTemplateFromEndpoint(descriptor);
      } catch (error) {
        const code =
          error instanceof SkMcpTemplateError ? error.code : "template_rejected";
        report({ code, message: (error as Error).message });
        if (
          atLeast(severityOf(code, this.options.diagnostics), "endpointDropped")
        ) {
          continue;
        }
        continue;
      }
      const entry: CatalogEntry = {
        tool,
        descriptor,
        controller: endpoint.controller,
        handlerName: endpoint.handlerName,
        ...(template === undefined ? {} : { template }),
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
        })),
      ),
      diagnostics,
      fatal,
      policyNames,
      discovered: discovered.length,
      selected: chosen.length,
    };
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
