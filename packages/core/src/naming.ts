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

export type PrefixMode = "always" | "onCollision";

const controllerSuffix = "Controller";

function fold(token: string): string {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

function tokensOf(name: string): string[] {
  return name
    .split("_")
    .filter((part) => part.length > 0)
    .map(fold);
}

export function derivePrefix(endpoint: EndpointDescriptor): string | undefined {
  if (endpoint.containerPrefix !== undefined) {
    return snakeCase(endpoint.containerPrefix);
  }
  const container = endpoint.container;
  if (container === undefined || container.trim() === "") {
    return undefined;
  }
  const segments = container.split(".").filter((part) => part.length > 0);
  let last = segments[segments.length - 1] ?? "";
  if (
    last.length > controllerSuffix.length &&
    last.endsWith(controllerSuffix)
  ) {
    last = last.slice(0, -controllerSuffix.length);
  }
  const prefix = snakeCase(last);
  return prefix === "" ? undefined : prefix;
}

function isRedundant(prefix: string, body: string): boolean {
  const prefixTokens = tokensOf(prefix);
  const bodyTokens = tokensOf(body);
  if (prefixTokens.length === 0 || prefixTokens.length > bodyTokens.length) {
    return false;
  }
  for (
    let start = 0;
    start + prefixTokens.length <= bodyTokens.length;
    start++
  ) {
    if (
      prefixTokens.every(
        (token, offset) => bodyTokens[start + offset] === token,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function applyPrefix(body: string, prefix: string | undefined): string {
  if (prefix === undefined || prefix === "" || isRedundant(prefix, body)) {
    return body;
  }
  return collapse(`${prefix}_${body}`);
}

function validate(name: string, endpoint: EndpointDescriptor): string {
  if (!toolNamePattern.test(name)) {
    throw new SkMcpCatalogError(
      "invalid_name",
      `Generated tool name '${name}' for ${endpoint.method} ${endpoint.route} does not match the required pattern; define an operationId or a tool name.`,
    );
  }
  return name;
}

export function createToolBody(endpoint: EndpointDescriptor): string {
  return endpoint.operationId === undefined ||
    endpoint.operationId.trim() === ""
    ? fromRoute(endpoint)
    : snakeCase(endpoint.operationId);
}

export function createToolName(
  endpoint: EndpointDescriptor,
  mode: PrefixMode = "always",
): string {
  if (endpoint.toolName !== undefined) {
    return validate(endpoint.toolName, endpoint);
  }
  const body = createToolBody(endpoint);
  const name =
    mode === "always" ? applyPrefix(body, derivePrefix(endpoint)) : body;
  return validate(name, endpoint);
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

export interface NamingOptions {
  readonly prefixMode?: PrefixMode;
  readonly onDiagnostic?: (code: string, message: string) => void;
}

export function createToolNames(
  endpoints: readonly EndpointDescriptor[],
  options: NamingOptions = {},
): string[] {
  const mode = options.prefixMode ?? "always";
  const operations = deduplicateOperations(endpoints, (e) => e);
  const names = operations.map((endpoint) => createToolName(endpoint, mode));

  if (mode === "onCollision") {
    const groups = new Map<string, number[]>();
    operations.forEach((endpoint, index) => {
      if (endpoint.toolName !== undefined) {
        return;
      }
      const group = groups.get(names[index] as string);
      if (group === undefined) {
        groups.set(names[index] as string, [index]);
      } else {
        group.push(index);
      }
    });
    for (const [body, group] of groups) {
      if (group.length < 2) {
        continue;
      }
      for (const index of group) {
        const endpoint = operations[index] as EndpointDescriptor;
        const prefixed = applyPrefix(body, derivePrefix(endpoint));
        if (prefixed === body) {
          continue;
        }
        names[index] = prefixed;
        options.onDiagnostic?.(
          "name_disambiguated",
          `Tool name '${body}' collided; ${endpoint.method} ${endpoint.route} is exposed as '${prefixed}'.`,
        );
      }
    }
  }

  const claimed = new Map<string, EndpointDescriptor>();
  operations.forEach((endpoint, index) => {
    const name = names[index] as string;
    const owner = claimed.get(name);
    if (owner !== undefined) {
      throw new SkMcpCatalogError(
        "name_collision",
        `Tool name '${name}' is produced by both ${owner.method} ${owner.route} and ${endpoint.method} ${endpoint.route}; declare a tool name on one of them.`,
      );
    }
    claimed.set(name, endpoint);
  });
  return names;
}
