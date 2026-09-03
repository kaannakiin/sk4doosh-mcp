import { SkMcpTemplateError } from "./errors.js";

export function assertUniqueArgumentNames(
  parameterNames: readonly string[],
  bodyPropertyNames: readonly string[],
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const name of parameterNames) {
    if (names.has(name)) {
      throw new SkMcpTemplateError(
        "duplicate_argument",
        `Duplicate argument name '${name}'.`,
      );
    }
    names.add(name);
  }

  const bodyProperties = new Set<string>();
  for (const property of bodyPropertyNames) {
    if (names.has(property)) {
      throw new SkMcpTemplateError(
        "argument_collision",
        `Body property '${property}' collides with a parameter name; rename one of them.`,
      );
    }
    names.add(property);
    bodyProperties.add(property);
  }
  return bodyProperties;
}
