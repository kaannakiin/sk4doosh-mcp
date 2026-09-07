import {
  ParseArrayPipe,
  ParseBoolPipe,
  ParseEnumPipe,
  ParseFloatPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  RequestMethod,
} from "@nestjs/common";
import { createRequire } from "node:module";
import type { EndpointDescriptor, JsonSchemaObject } from "@sk-mcp/core";
import { simplifySchema } from "@sk-mcp/core";
import { markersOf, type McpToolOptions } from "../decorators.js";
import {
  NestTypeShapeBinder,
  type TypeShapeBinderOptions,
} from "./type-shape.js";

const load = createRequire(import.meta.url);

const { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } =
  load("@nestjs/common/constants") as {
    GUARDS_METADATA: string;
    METHOD_METADATA: string;
    PATH_METADATA: string;
    ROUTE_ARGS_METADATA: string;
  };

const { RouteParamtypes } = load(
  "@nestjs/common/enums/route-paramtypes.enum",
) as { RouteParamtypes: Record<string, number> };

const BODY = RouteParamtypes["BODY"] as number;
const QUERY = RouteParamtypes["QUERY"] as number;
const PARAM = RouteParamtypes["PARAM"] as number;
const HEADERS = RouteParamtypes["HEADERS"] as number;
const FILE = RouteParamtypes["FILE"] as number;
const FILES = RouteParamtypes["FILES"] as number;
const RAW_BODY = RouteParamtypes["RAW_BODY"] as number;

export interface DiscoveryDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface ControllerCandidate {
  readonly metatype: NewableFunction;
  readonly modulePath?: string;
}

export interface VisibilityDeclaration {
  readonly anonymous?: "yes" | "no" | "unknown";
  readonly policies?: readonly string[];
}

export interface DiscoveryOptions {
  readonly globalPrefix?: string;
  readonly schema?: TypeShapeBinderOptions;
  readonly globalGuards?: readonly unknown[];
  readonly report?: (diagnostic: DiscoveryDiagnostic) => void;
}

export interface DiscoveredEndpoint {
  readonly descriptor: EndpointDescriptor;
  readonly controller: NewableFunction;
  readonly handlerName: string;
  readonly containerMarkers: readonly boolean[];
  readonly operationMarkers: readonly boolean[];
  readonly hints: McpToolOptions;
}

const methodNames: Partial<
  Record<RequestMethod, EndpointDescriptor["method"]>
> = {
  [RequestMethod.GET]: "GET",
  [RequestMethod.POST]: "POST",
  [RequestMethod.PUT]: "PUT",
  [RequestMethod.DELETE]: "DELETE",
  [RequestMethod.PATCH]: "PATCH",
  [RequestMethod.HEAD]: "HEAD",
};

const pipeScalars: ReadonlyArray<readonly [unknown, JsonSchemaObject]> = [
  [ParseIntPipe, { type: "integer" }],
  [ParseFloatPipe, { type: "number" }],
  [ParseBoolPipe, { type: "boolean" }],
  [ParseUUIDPipe, { type: "string", format: "uuid" }],
  [ParseEnumPipe, { type: "string" }],
];

interface ArgumentEntry {
  readonly index: number;
  readonly data?: unknown;
  readonly pipes?: readonly unknown[];
}

export function discoverEndpoints(
  controllers: readonly ControllerCandidate[],
  options: DiscoveryOptions = {},
): DiscoveredEndpoint[] {
  const found: DiscoveredEndpoint[] = [];
  for (const candidate of controllers) {
    found.push(...fromController(candidate, options));
  }
  return found;
}

function fromController(
  candidate: ControllerCandidate,
  options: DiscoveryOptions,
): DiscoveredEndpoint[] {
  const controller = candidate.metatype;
  const prototype = controller.prototype as Record<string, unknown>;
  const classPaths = pathsOf(controller);
  const containerMarkers = markersOf(controller);
  const results: DiscoveredEndpoint[] = [];

  for (const handlerName of handlerNames(prototype)) {
    const handler = prototype[handlerName] as (...args: never[]) => unknown;
    const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
      RequestMethod | undefined;
    if (verb === undefined) {
      continue;
    }
    const method = methodNames[verb];
    const operationMarkers = markersOf(handler);
    const hints = mergeHints(containerMarkers, operationMarkers);

    if (method === undefined) {
      options.report?.({
        code: "unsupported_method",
        message: `${controller.name}.${handlerName} is bound to an HTTP method with no neutral-model counterpart; endpoint skipped.`,
      });
      continue;
    }

    for (const methodPath of pathsOf(handler)) {
      const route = joinRoute([
        options.globalPrefix,
        candidate.modulePath,
        ...classPaths.slice(0, 1),
        methodPath,
      ]);
      const wildcard = /[*]/.test(route);
      if (wildcard) {
        options.report?.({
          code: "unsupported_binding",
          message: `${controller.name}.${handlerName} uses a wildcard route segment, which the neutral route model cannot express; endpoint skipped.`,
        });
        continue;
      }
      const built = describe(
        controller,
        handlerName,
        handler,
        method,
        route,
        hints,
        options,
      );
      if (built === undefined) {
        continue;
      }
      results.push({
        descriptor: built,
        controller,
        handlerName,
        containerMarkers: containerMarkers.map((marker) => marker.include),
        operationMarkers: operationMarkers.map((marker) => marker.include),
        hints,
      });
    }
  }
  return results;
}

function describe(
  controller: NewableFunction,
  handlerName: string,
  handler: (...args: never[]) => unknown,
  method: EndpointDescriptor["method"],
  route: string,
  hints: McpToolOptions,
  options: DiscoveryOptions,
): EndpointDescriptor | undefined {
  const args = argumentsOf(controller, handlerName);
  const paramTypes = (Reflect.getMetadata(
    "design:paramtypes",
    controller.prototype as object,
    handlerName,
  ) ?? []) as unknown[];

  const declared: NonNullable<EndpointDescriptor["parameters"]> = [];
  let bodySchema: JsonSchemaObject | undefined;
  let bodyFields: Record<string, JsonSchemaObject> | undefined;
  let unsupported = false;

  for (const [key, entry] of Object.entries(args)) {
    const kind = Number(key.split(":")[0]);
    const name = typeof entry.data === "string" ? entry.data : undefined;
    const declaredType = paramTypes[entry.index];

    switch (kind) {
      case QUERY:
        if (name === undefined) {
          options.report?.({
            code: "unbound_query_object",
            message: `${controller.name}.${handlerName} binds the whole query object; its members cannot be read, so they are omitted from the tool.`,
          });
          break;
        }
        declared.push({
          name,
          in: "query",
          required: false,
          schema: scalarFor(entry, declaredType),
        });
        break;
      case HEADERS:
        if (name !== undefined) {
          declared.push({
            name,
            in: "header",
            required: false,
            schema: scalarFor(entry, declaredType),
          });
        }
        break;
      case BODY:
        if (name === undefined) {
          bodySchema = bodyFor(declaredType, options);
        } else {
          bodyFields ??= {};
          bodyFields[name] = bodyFor(declaredType, options);
        }
        break;
      case FILE:
      case FILES:
      case RAW_BODY:
        unsupported = true;
        break;
      default:
        break;
    }
  }

  if (unsupported) {
    options.report?.({
      code: "unsupported_binding",
      message: `${controller.name}.${handlerName} binds a file or raw body; endpoint skipped.`,
    });
    return undefined;
  }
  if (bodySchema !== undefined && bodyFields !== undefined) {
    options.report?.({
      code: "multiple_body_bindings",
      message: `${controller.name}.${handlerName} mixes a whole-body binding with named body members; endpoint skipped.`,
    });
    return undefined;
  }
  if (bodyFields !== undefined) {
    bodySchema = { type: "object", properties: bodyFields };
  }

  const pathParameters = placeholdersOf(route).map((placeholder) => ({
    name: placeholder,
    in: "path" as const,
    required: true,
    schema:
      pathSchema(args, paramTypes, placeholder) ??
      ({ type: "string" } as JsonSchemaObject),
  }));

  const parameters = [
    ...pathParameters,
    ...declared.filter((parameter) => parameter.in !== "path"),
  ];

  const descriptor: EndpointDescriptor = {
    operationId: handlerName,
    container: controller.name,
    method,
    route,
    auth: authOf(controller, handler, options.globalGuards ?? []),
    tags: [controller.name.replace(/Controller$/, "")],
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(bodySchema === undefined
      ? {}
      : { requestBody: { schema: bodySchema } }),
  };

  const description = descriptionOf(handler, hints);
  return description === undefined
    ? descriptor
    : { ...descriptor, description };
}

function authOf(
  controller: NewableFunction,
  handler: (...args: never[]) => unknown,
  globalGuards: readonly unknown[],
): EndpointDescriptor["auth"] {
  const guards = [
    ...globalGuards,
    ...guardsOn(controller),
    ...guardsOn(handler),
  ];
  if (guards.length === 0) {
    return { anonymous: "unknown", policies: [], imperative: false };
  }

  let anonymous: EndpointDescriptor["auth"]["anonymous"] | undefined;
  const policies: string[] = [];

  for (const guard of guards) {
    const declaration = declarationOf(guard);
    if (declaration === undefined) {
      continue;
    }
    if (declaration.anonymous !== undefined) {
      anonymous =
        declaration.anonymous === "no" || anonymous === "no"
          ? "no"
          : declaration.anonymous;
    }
    for (const policy of declaration.policies ?? []) {
      if (!policies.includes(policy)) {
        policies.push(policy);
      }
    }
  }

  return {
    anonymous: anonymous ?? "unknown",
    policies,
    imperative: guards.some((guard) => declarationOf(guard) === undefined),
  };
}

function declarationOf(guard: unknown): VisibilityDeclaration | undefined {
  const instance =
    typeof guard === "function"
      ? (guard as { prototype?: unknown }).prototype
      : guard;
  const describe = (instance as { describeVisibility?: unknown } | null)
    ?.describeVisibility;
  if (typeof describe !== "function") {
    return undefined;
  }
  try {
    return (describe as () => VisibilityDeclaration).call(instance);
  } catch {
    return undefined;
  }
}

function guardsOn(target: object | NewableFunction): unknown[] {
  const declared = Reflect.getMetadata(GUARDS_METADATA, target) as
    unknown[] | undefined;
  return declared ?? [];
}

function descriptionOf(
  handler: (...args: never[]) => unknown,
  hints: McpToolOptions,
): string | undefined {
  if (hints.description !== undefined && hints.description.length > 0) {
    return hints.description;
  }
  const operation = Reflect.getMetadata("swagger/apiOperation", handler) as
    { description?: string; summary?: string } | undefined;
  const declared = operation?.description ?? operation?.summary;
  return declared !== undefined && declared.length > 0 ? declared : undefined;
}

function bodyFor(
  declaredType: unknown,
  options: DiscoveryOptions,
): JsonSchemaObject {
  const binder = new NestTypeShapeBinder({
    ...options.schema,
    report: (diagnostic) => options.report?.(diagnostic),
  });
  const { schema, diagnostics } = simplifySchema(binder.bind(declaredType));
  for (const diagnostic of diagnostics) {
    options.report?.(diagnostic);
  }
  return schema;
}

function scalarFor(
  entry: ArgumentEntry,
  declaredType: unknown,
): JsonSchemaObject {
  const piped = pipeSchema(entry.pipes);
  if (piped !== undefined) {
    return piped;
  }
  if (declaredType === Number) {
    return { type: "number" };
  }
  if (declaredType === Boolean) {
    return { type: "boolean" };
  }
  return { type: "string" };
}

function pipeSchema(
  pipes: readonly unknown[] | undefined,
): JsonSchemaObject | undefined {
  for (const pipe of pipes ?? []) {
    const constructor =
      typeof pipe === "function"
        ? pipe
        : (pipe as { constructor?: unknown } | null)?.constructor;
    if (constructor === ParseArrayPipe) {
      return { type: "array", items: { type: "string" } };
    }
    for (const [candidate, schema] of pipeScalars) {
      if (constructor === candidate) {
        return { ...schema };
      }
    }
  }
  return undefined;
}

function pathSchema(
  args: Record<string, ArgumentEntry>,
  paramTypes: readonly unknown[],
  placeholder: string,
): JsonSchemaObject | undefined {
  for (const [key, entry] of Object.entries(args)) {
    const kind = Number(key.split(":")[0]);
    if (kind !== PARAM || entry.data !== placeholder) {
      continue;
    }
    return scalarFor(entry, paramTypes[entry.index]);
  }
  return undefined;
}

function argumentsOf(
  controller: NewableFunction,
  handlerName: string,
): Record<string, ArgumentEntry> {
  return (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) ??
    {}) as Record<string, ArgumentEntry>;
}

function mergeHints(
  container: ReturnType<typeof markersOf>,
  operation: ReturnType<typeof markersOf>,
): McpToolOptions {
  const merged: Record<string, unknown> = {};
  for (const marker of [...container, ...operation]) {
    for (const [key, value] of Object.entries(marker.options)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
  }
  return merged as McpToolOptions;
}

function handlerNames(prototype: Record<string, unknown>): string[] {
  const names = new Set<string>();
  let current: object | null = prototype;
  while (current !== null && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (
        name !== "constructor" &&
        typeof (current as Record<string, unknown>)[name] === "function"
      ) {
        names.add(name);
      }
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return [...names];
}

function pathsOf(target: object | NewableFunction): string[] {
  const declared = Reflect.getMetadata(PATH_METADATA, target) as
    string | string[] | undefined;
  if (declared === undefined) {
    return [""];
  }
  const paths = Array.isArray(declared) ? declared : [declared];
  return paths.length === 0 ? [""] : paths;
}

function joinRoute(parts: ReadonlyArray<string | undefined>): string {
  const segments: string[] = [];
  for (const part of parts) {
    if (part === undefined) {
      continue;
    }
    for (const segment of part.split("/")) {
      const trimmed = segment.trim();
      if (trimmed.length > 0 && trimmed !== "/") {
        segments.push(normalizeSegment(trimmed));
      }
    }
  }
  return `/${segments.join("/")}`;
}

function normalizeSegment(segment: string): string {
  if (!segment.startsWith(":")) {
    return segment;
  }
  const name = segment.slice(1).replace(/[?]$/, "");
  return `{${name}}`;
}

function placeholdersOf(route: string): string[] {
  const found: string[] = [];
  for (const match of route.matchAll(/\{([^}]+)\}/g)) {
    found.push(match[1] as string);
  }
  return found;
}
