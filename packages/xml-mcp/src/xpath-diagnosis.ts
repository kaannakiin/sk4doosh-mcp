import { SkMcpXmlError } from "./errors.js";
import type { NamespaceBinding } from "./node-model.js";
import { lex } from "./xpath-lex.js";

const laterVersionFunctions = new Set([
  "matches",
  "replace",
  "tokenize",
  "upper-case",
  "lower-case",
  "ends-with",
  "distinct-values",
  "string-join",
  "min",
  "max",
  "avg",
  "abs",
  "exists",
  "empty",
  "index-of",
  "subsequence",
  "deep-equal",
  "data",
  "node-name",
  "current-date",
  "current-dateTime",
  "format-number",
  "for-each",
  "filter",
  "head",
  "tail",
  "reverse",
  "sort",
  "parse-xml",
  "serialize",
  "analyze-string",
]);

const aliasAdvice =
  "Bind it in namespaces; describe_document returns an alias for every namespace in the document.";

const versionAdvice =
  "This server evaluates XPath 1.0 only. Rewrite the expression without that function.";

const unboundPrefix = /Undefined namespace prefix:\s*(\S+)/u;
const unknownFunction = /Unregistered function:\s*(\S+)/u;

function missingPrefixes(
  expression: string,
  bindings: readonly NamespaceBinding[],
): readonly string[] {
  const bound = new Set(bindings.map((binding) => binding.prefix));
  bound.add("xml");
  return lex(expression).prefixes.filter((prefix) => !bound.has(prefix));
}

function laterVersionUse(expression: string): string | undefined {
  return lex(expression).functions.find((name) =>
    laterVersionFunctions.has(name),
  );
}

/**
 * The engine never evaluates a predicate whose step matched nothing, so an
 * expression carrying a later-version function can come back as a plain empty
 * node-set and read as a success. Refusing before evaluation is a refusal, not
 * a rewrite: the expression is never altered.
 */
export function refuseUnsupported(
  expression: string,
): SkMcpXmlError | undefined {
  const lexed = lex(expression);
  const laterVersion = lexed.functions.find((name) =>
    laterVersionFunctions.has(name),
  );
  if (laterVersion !== undefined) {
    return new SkMcpXmlError(
      "query_not_supported",
      `${laterVersion}() belongs to XPath 2.0 or later and this engine does not provide it.`,
      versionAdvice,
    );
  }
  if (lexed.axes.includes("namespace")) {
    return new SkMcpXmlError(
      "query_not_supported",
      "The namespace axis returns nodes whose prefix and URI this engine does not expose, so their content cannot be reported.",
      "Read the namespace bindings from describe_document, which lists every namespace with an alias.",
    );
  }
  return undefined;
}

export function diagnoseQuery(
  failure: "xpath_compile" | "xpath_eval",
  detail: string | undefined,
  expression: string,
  bindings: readonly NamespaceBinding[],
): SkMcpXmlError {
  const engine = detail ?? "";

  const prefixFault = unboundPrefix.exec(engine);
  if (prefixFault !== null) {
    return new SkMcpXmlError(
      "invalid_argument",
      `The expression uses the namespace prefix ${prefixFault[1] ?? ""}, which is not bound.`,
      aliasAdvice,
    );
  }

  const functionFault = unknownFunction.exec(engine);
  if (functionFault !== null) {
    const name = functionFault[1] ?? "";
    return laterVersionFunctions.has(name)
      ? new SkMcpXmlError(
          "query_not_supported",
          `${name}() belongs to XPath 2.0 or later and this engine does not provide it.`,
          versionAdvice,
        )
      : new SkMcpXmlError(
          "invalid_argument",
          `There is no XPath 1.0 function named ${name}.`,
          "Check the spelling, or use one of the XPath 1.0 functions.",
        );
  }

  const laterVersion = laterVersionUse(expression);
  if (laterVersion !== undefined) {
    return new SkMcpXmlError(
      "query_not_supported",
      `${laterVersion}() belongs to XPath 2.0 or later and this engine does not provide it.`,
      versionAdvice,
    );
  }

  const unbound = missingPrefixes(expression, bindings);
  const firstUnbound = unbound[0];
  if (failure === "xpath_eval" && firstUnbound !== undefined) {
    return new SkMcpXmlError(
      "invalid_argument",
      `The expression uses the namespace prefix ${firstUnbound}, which is not bound.`,
      aliasAdvice,
    );
  }

  return new SkMcpXmlError(
    "invalid_argument",
    "The expression is not valid XPath 1.0 and the engine reported no position for the fault.",
    "Check the brackets, quotes and axis names; describe_document shows addresses that need no expression at all.",
  );
}

export interface QueryDiagnostic {
  readonly code: "default_namespace_unprefixed";
  readonly message: string;
  readonly recovery: string;
}

/**
 * XPath 1.0 never binds an unprefixed name test to a default namespace, so an
 * expression that looks right returns nothing on a document that declares one.
 * This is reported alongside the empty result; no second query is run.
 */
export function emptyResultDiagnostic(
  expression: string,
  rootNamespaceUri: string,
): QueryDiagnostic | undefined {
  if (rootNamespaceUri === "") return undefined;
  const tests = lex(expression).unprefixedNameTests;
  if (tests.length === 0) return undefined;
  return {
    code: "default_namespace_unprefixed",
    message: `The node-set is empty. The document element is in the namespace ${rootNamespaceUri}, and in XPath 1.0 an unprefixed name test such as ${tests[0] ?? ""} matches only elements in no namespace.`,
    recovery: aliasAdvice,
  };
}
