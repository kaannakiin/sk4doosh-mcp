import type { JsonSchemaObject } from "@sk-mcp/core";

export interface McpToolOptions {
  readonly name?: string;
  readonly prefix?: string;
  readonly description?: string;
  readonly body?: JsonSchemaObject;
  readonly readOnly?: boolean;
  readonly destructive?: boolean;
  readonly idempotent?: boolean;
}

export interface McpSelectionMarker {
  readonly include: boolean;
  readonly options: McpToolOptions;
}

export const MCP_SELECTION = "sk-mcp:selection";

type Target = object | ((...args: never[]) => unknown);

function append(target: Target, marker: McpSelectionMarker): void {
  const existing =
    (Reflect.getOwnMetadata(MCP_SELECTION, target) as
      McpSelectionMarker[] | undefined) ?? [];
  Reflect.defineMetadata(MCP_SELECTION, [...existing, marker], target);
}

function decorate(
  marker: McpSelectionMarker,
): ClassDecorator & MethodDecorator {
  return ((
    target: Target,
    _property?: string | symbol,
    descriptor?: PropertyDescriptor,
  ): void => {
    append(descriptor?.value !== undefined ? descriptor.value : target, marker);
  }) as ClassDecorator & MethodDecorator;
}

export function McpTool(
  options: McpToolOptions = {},
): ClassDecorator & MethodDecorator {
  return decorate({ include: true, options });
}

export function McpIgnore(): ClassDecorator & MethodDecorator {
  return decorate({ include: false, options: {} });
}

export function markersOf(target: Target | undefined): McpSelectionMarker[] {
  if (target === undefined) {
    return [];
  }
  return (
    (Reflect.getOwnMetadata(MCP_SELECTION, target) as
      McpSelectionMarker[] | undefined) ?? []
  );
}
