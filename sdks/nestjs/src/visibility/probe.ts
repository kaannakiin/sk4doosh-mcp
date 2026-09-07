import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { of, type Observable } from "rxjs";
import type { VisibilityDecision } from "@sk-mcp/core";
import type { CatalogEntry } from "../catalog.js";
import { SkMcpDispatcher } from "../dispatcher.js";
import {
  isSkMcpProbe,
  markShortCircuited,
  wasShortCircuited,
} from "../markers.js";
import type { OuterRequest, SkMcpOptions } from "../options.js";

@Injectable()
export class SkMcpProbeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request: unknown = context.switchToHttp().getRequest();
    if (!isSkMcpProbe(request)) {
      return next.handle();
    }
    markShortCircuited(request as object);
    return of(undefined);
  }
}

export interface ProbeEvaluator {
  canProbe(entry: CatalogEntry): boolean;
  probe(
    entry: CatalogEntry,
    outer: OuterRequest | undefined,
  ): Promise<VisibilityDecision>;
}

export class SkMcpProbeEvaluator implements ProbeEvaluator {
  private readonly disabled = new Map<string, string>();

  constructor(
    private readonly dispatcher: SkMcpDispatcher,
    private readonly options: SkMcpOptions,
  ) {}

  clearDisabled(): void {
    this.disabled.clear();
  }

  canProbe(entry: CatalogEntry): boolean {
    return entry.template !== undefined && !this.disabled.has(entry.tool.name);
  }

  async probe(
    entry: CatalogEntry,
    outer: OuterRequest | undefined,
  ): Promise<VisibilityDecision> {
    const path = this.pathFor(entry);
    const result = await this.dispatcher.probe(
      entry.descriptor.method,
      path,
      outer,
    );

    if (result.status === 401 || result.status === 403) {
      return "deny";
    }
    if (result.shortCircuited && result.status < 400) {
      return "allow";
    }
    this.disabled.set(
      entry.tool.name,
      result.status === 404
        ? "the probe path did not route; declare a value in visibility.probeValues"
        : "the response came back without the short-circuit marker",
    );
    return "unknown";
  }

  private pathFor(entry: CatalogEntry): string {
    return entry.descriptor.route.replaceAll(
      /\{([^}]+)\}/g,
      (_match, name: string) =>
        encodeURIComponent(
          this.options.visibility.probeValues.get(name.toLowerCase()) ??
            placeholderFor(entry, name),
        ),
    );
  }
}

function placeholderFor(entry: CatalogEntry, name: string): string {
  const parameter = entry.descriptor.parameters?.find(
    (candidate) => candidate.name === name && candidate.in === "path",
  );
  switch (parameter?.schema.type) {
    case "integer":
    case "number":
      return "1";
    case "boolean":
      return "true";
    default:
      break;
  }
  if (parameter?.schema.format === "uuid") {
    return "00000000-0000-0000-0000-000000000000";
  }
  if (parameter?.schema.format === "date-time") {
    return "2000-01-01";
  }
  return "probe";
}

export { wasShortCircuited };
