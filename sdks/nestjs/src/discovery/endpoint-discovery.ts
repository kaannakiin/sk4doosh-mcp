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
import {
  allowsAdditional,
  flattenableBody,
  simplifySchema,
  typeOf,
} from "@sk-mcp/core";
import { markersOf, type McpToolOptions } from "../decorators.js";
import { atLeast, severityOf, type CatalogSeverity } from "./diagnostics.js";
import {
  NestTypeShapeBinder,
  type TypeShapeBinderOptions,
} from "./type-shape.js";

const load = createRequire(import.meta.url);

const {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_PATH,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
  VERSION_METADATA,
} = load("@nestjs/common/constants") as {
  GUARDS_METADATA: string;
  METHOD_METADATA: string;
  MODULE_PATH: string;
  PATH_METADATA: string;
  ROUTE_ARGS_METADATA: string;
  VERSION_METADATA: string;
};

const { RouteParamtypes } = load(
  "@nestjs/common/enums/route-paramtypes.enum",
) as { RouteParamtypes: Record<string, number> };

const { RoutePathFactory } = load("@nestjs/core/router/route-path-factory") as {
  RoutePathFactory: new (applicationConfig: unknown) => RoutePaths;
};

const BODY = RouteParamtypes["BODY"] as number;
const QUERY = RouteParamtypes["QUERY"] as number;
const PARAM = RouteParamtypes["PARAM"] as number;
const HEADERS = RouteParamtypes["HEADERS"] as number;
const FILE = RouteParamtypes["FILE"] as number;
const FILES = RouteParamtypes["FILES"] as number;
const RAW_BODY = RouteParamtypes["RAW_BODY"] as number;

export interface RoutePathMetadata {
  readonly ctrlPath?: string;
  readonly methodPath?: string;
  readonly globalPrefix?: string;
  readonly modulePath?: string;
  readonly controllerVersion?: unknown;
  readonly methodVersion?: unknown;
  readonly versioningOptions?: unknown;
}

export interface RoutePaths {
  create(metadata: RoutePathMetadata, requestMethod?: number): string[];
}

/** `RoutePathFactory` reads `getGlobalPrefixOptions()`; with no application there is no exclusion list. */
export function createRoutePaths(applicationConfig?: unknown): RoutePaths {
  return new RoutePathFactory(
    applicationConfig ?? { getGlobalPrefixOptions: () => ({}) },
  );
}

const withoutApplication = createRoutePaths();

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
  readonly versioningOptions?: unknown;
  readonly routePaths?: RoutePaths;
  readonly schema?: TypeShapeBinderOptions;
  readonly globalGuards?: readonly unknown[];
  readonly severity?: (code: string) => CatalogSeverity;
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

const queryScalars = new Set(["string", "number", "integer", "boolean"]);

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

/** `RouterModule` writes the module path under a key scoped to the application instance, falling back to the bare key. */
export function modulePathOf(
  moduleMetatype: unknown,
  applicationId: string,
): string | undefined {
  if (typeof moduleMetatype !== "function") {
    return undefined;
  }
  const scoped = Reflect.getMetadata(
    MODULE_PATH + applicationId,
    moduleMetatype,
  ) as string | undefined;
  return (
    scoped ??
    (Reflect.getMetadata(MODULE_PATH, moduleMetatype) as string | undefined)
  );
}

function fromController(
  candidate: ControllerCandidate,
  options: DiscoveryOptions,
): DiscoveredEndpoint[] {
  const controller = candidate.metatype;
  const prototype = controller.prototype as Record<string, unknown>;
  const classPaths = pathsOf(controller);
  const controllerVersion = Reflect.getMetadata(
    VERSION_METADATA,
    controller,
  ) as unknown;
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

    for (const route of routesOf(
      candidate,
      classPaths,
      pathsOf(handler),
      controllerVersion,
      Reflect.getMetadata(VERSION_METADATA, handler) as unknown,
      verb,
      options,
    )) {
      if (/[*]/.test(route)) {
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

function routesOf(
  candidate: ControllerCandidate,
  classPaths: readonly string[],
  methodPaths: readonly string[],
  controllerVersion: unknown,
  methodVersion: unknown,
  requestMethod: RequestMethod,
  options: DiscoveryOptions,
): string[] {
  const factory = options.routePaths ?? withoutApplication;
  const routes = new Set<string>();
  for (const ctrlPath of classPaths) {
    for (const methodPath of methodPaths) {
      const created = factory.create(
        {
          ctrlPath,
          methodPath,
          ...(options.globalPrefix === undefined
            ? {}
            : { globalPrefix: options.globalPrefix }),
          ...(candidate.modulePath === undefined
            ? {}
            : { modulePath: candidate.modulePath }),
          ...(controllerVersion === undefined ? {} : { controllerVersion }),
          ...(methodVersion === undefined ? {} : { methodVersion }),
          ...(options.versioningOptions === undefined
            ? {}
            : { versioningOptions: options.versioningOptions }),
        },
        requestMethod,
      );
      for (const route of created) {
        routes.add(normalizeRoute(route));
      }
    }
  }
  return [...routes];
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
  const expanded: NonNullable<EndpointDescriptor["parameters"]> = [];
  let bodySchema: JsonSchemaObject | undefined;
  let bodyFields: Record<string, JsonSchemaObject> | undefined;
  let unsupported = false;
  let unresolvedQuery = false;

  for (const [key, entry] of Object.entries(args)) {
    const kind = Number(key.split(":")[0]);
    const name = typeof entry.data === "string" ? entry.data : undefined;
    const declaredType = paramTypes[entry.index];

    switch (kind) {
      case QUERY: {
        if (name !== undefined) {
          declared.push({
            name,
            in: "query",
            required: false,
            schema: scalarFor(entry, declaredType),
          });
          break;
        }
        const members = queryFor(
          controller,
          handlerName,
          declaredType,
          options,
        );
        if (members === undefined) {
          unresolvedQuery = true;
          break;
        }
        expanded.push(...members);
        break;
      }
      case HEADERS:
        if (name === undefined) {
          options.report?.({
            code: "unbound_header_object",
            message: `${controller.name}.${handlerName} binds the whole header object; its members cannot be read, so they are omitted from the tool. Bind the headers the tool needs by name.`,
          });
          break;
        }
        declared.push({
          name,
          in: "header",
          required: false,
          schema: scalarFor(entry, declaredType),
        });
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
  if (
    unresolvedQuery &&
    atLeast(
      (options.severity ?? severityOf)("unresolved_query_shape"),
      "endpointDropped",
    )
  ) {
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

  const claimed = new Set([
    ...pathParameters.map((parameter) => parameter.name),
    ...declared.map((parameter) => parameter.name),
  ]);
  const parameters = [
    ...pathParameters,
    ...declared.filter((parameter) => parameter.in !== "path"),
    ...expanded.filter((parameter) => !claimed.has(parameter.name)),
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

function shapeOf(
  declaredType: unknown,
  options: DiscoveryOptions,
): { schema: JsonSchemaObject; diagnostics: DiscoveryDiagnostic[] } {
  const collected: DiscoveryDiagnostic[] = [];
  const binder = new NestTypeShapeBinder({
    ...options.schema,
    report: (diagnostic) => collected.push(diagnostic),
  });
  const { schema, diagnostics } = simplifySchema(binder.bind(declaredType));
  collected.push(...diagnostics);
  return { schema, diagnostics: collected };
}

function bodyFor(
  declaredType: unknown,
  options: DiscoveryOptions,
): JsonSchemaObject {
  const { schema, diagnostics } = shapeOf(declaredType, options);
  for (const diagnostic of diagnostics) {
    options.report?.(diagnostic);
  }
  return schema;
}

function isQueryable(schema: JsonSchemaObject): boolean {
  const type = typeOf(schema);
  if (type === "array") {
    const items = schema.items;
    return items !== undefined && queryScalars.has(typeOf(items) ?? "");
  }
  return queryScalars.has(type ?? "");
}

function queryFor(
  controller: NewableFunction,
  handlerName: string,
  declaredType: unknown,
  options: DiscoveryOptions,
): EndpointDescriptor["parameters"] | undefined {
  const { schema, diagnostics } = shapeOf(declaredType, options);
  const flattenable = flattenableBody(schema);
  const properties = flattenable?.properties ?? {};
  const unresolved = (): undefined => {
    options.report?.({
      code: "unresolved_query_shape",
      message: `${controller.name}.${handlerName} binds the whole query object but no member of '${nameOf(declaredType)}' can be read, so the tool would carry no filters. Decorate its properties with class-validator, or declare options.schema.typeShape.`,
    });
    return undefined;
  };

  if (allowsAdditional(schema) || Object.keys(properties).length === 0) {
    return unresolved();
  }

  const required = new Set(flattenable?.required ?? []);
  const parameters: NonNullable<EndpointDescriptor["parameters"]> = [];
  const skipped: string[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (!isQueryable(property)) {
      skipped.push(name);
      continue;
    }
    parameters.push({
      name,
      in: "query",
      required: required.has(name),
      schema: property,
    });
  }

  if (parameters.length === 0) {
    return unresolved();
  }

  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== "unreadable_shape") {
      options.report?.(diagnostic);
    }
  }
  if (skipped.length > 0) {
    options.report?.({
      code: "unbound_query_object",
      message: `${controller.name}.${handlerName} binds the whole query object; ${skipped.join(", ")} cannot be expressed as query parameters and are omitted from the tool.`,
    });
  }
  return parameters;
}

function nameOf(declaredType: unknown): string {
  return typeof declaredType === "function"
    ? declaredType.name
    : "the query type";
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

export function normalizeRoute(route: string): string {
  const segments: string[] = [];
  for (const segment of route.split("/")) {
    const trimmed = segment.trim();
    if (trimmed.length > 0 && trimmed !== "/") {
      segments.push(normalizeSegment(trimmed));
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
