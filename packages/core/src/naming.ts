import { SkMcpCatalogError } from "./errors.js";
import type { EndpointDescriptor } from "./generated/endpoint-descriptor.js";

export const longNameThreshold = 64;

const toolNamePattern = /^[a-z][a-z0-9_]{0,255}$/;

const isAsciiUpper = (c: string): boolean => c >= "A" && c <= "Z";
const isAsciiLower = (c: string): boolean => c >= "a" && c <= "z";
const isAsciiDigit = (c: string): boolean => c >= "0" && c <= "9";

function collapse(value: string): string {
  return value.replace(/_+/g, "_").replace(/^_|_$/g, "");
}

export function snakeCase(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index] as string;
    if (isAsciiUpper(character)) {
      const previous = index > 0 ? (value[index - 1] as string) : "";
      const next = index + 1 < value.length ? (value[index + 1] as string) : "";
      const afterLowercase = previous !== "" && isAsciiLower(previous);
      const acronymEnd =
        previous !== "" &&
        isAsciiUpper(previous) &&
        next !== "" &&
        isAsciiLower(next);
      if (out.length > 0 && (afterLowercase || acronymEnd)) {
        out += "_";
      }
      out += character.toLowerCase();
    } else if (isAsciiLower(character) || isAsciiDigit(character)) {
      out += character;
    } else {
      out += "_";
    }
  }
  return collapse(out);
}

function placeholderName(placeholder: string): string {
  const name = placeholder.replace(/^\*+/, "");
  const constraint = name.search(/[:?=]/);
  return constraint >= 0 ? name.slice(0, constraint) : name;
}

function fromRoute(endpoint: EndpointDescriptor): string {
  const parts = [endpoint.method.toLowerCase()];
  const pathParameters: string[] = [];
  for (const segment of endpoint.route.split("/").filter((s) => s.length > 0)) {
    if (segment.startsWith("{") && segment.endsWith("}")) {
      pathParameters.push(
        "by_" + snakeCase(placeholderName(segment.slice(1, -1))),
      );
    } else {
      parts.push(snakeCase(segment));
    }
  }
  return collapse([...parts, ...pathParameters].join("_"));
}

export function createToolName(endpoint: EndpointDescriptor): string {
  const name =
    endpoint.operationId === undefined || endpoint.operationId.trim() === ""
      ? fromRoute(endpoint)
      : snakeCase(endpoint.operationId);
  if (!toolNamePattern.test(name)) {
    throw new SkMcpCatalogError(
      "invalid_name",
      `Generated tool name '${name}' for ${endpoint.method} ${endpoint.route} does not match the required pattern; define an operationId.`,
    );
  }
  return name;
}

function shorter(candidate: string, current: string): boolean {
  if (candidate.length !== current.length) {
    return candidate.length < current.length;
  }
  return candidate < current;
}

export function deduplicateOperations<T>(
  items: readonly T[],
  selector: (item: T) => EndpointDescriptor,
): T[] {
  const operations: T[] = [];
  const seen = new Map<string, number>();
  for (const item of items) {
    const endpoint = selector(item);
    if (
      endpoint.operationId === undefined ||
      endpoint.operationId.trim() === ""
    ) {
      operations.push(item);
      continue;
    }
    const key = JSON.stringify([
      endpoint.container ?? "",
      endpoint.operationId,
      endpoint.method.toUpperCase(),
    ]);
    const index = seen.get(key);
    if (index === undefined) {
      seen.set(key, operations.length);
      operations.push(item);
      continue;
    }
    if (shorter(endpoint.route, selector(operations[index] as T).route)) {
      operations[index] = item;
    }
  }
  return operations;
}

export function createToolNames(
  endpoints: readonly EndpointDescriptor[],
): string[] {
  const names: string[] = [];
  const claimed = new Map<string, EndpointDescriptor>();
  for (const endpoint of deduplicateOperations(endpoints, (e) => e)) {
    const name = createToolName(endpoint);
    const owner = claimed.get(name);
    if (owner !== undefined) {
      throw new SkMcpCatalogError(
        "name_collision",
        `Tool name '${name}' is produced by both ${owner.method} ${owner.route} and ${endpoint.method} ${endpoint.route}; define an operationId on one of them.`,
      );
    }
    claimed.set(name, endpoint);
    names.push(name);
  }
  return names;
}
