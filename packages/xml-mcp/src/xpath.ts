import {
  XmlAttribute,
  XmlCData,
  XmlComment,
  XmlDocument,
  XmlElement,
  XmlEntityReference,
  XmlText,
  XmlXPath,
  type XmlNode,
} from "libxml2-wasm";
import { locate, nodeIdOf, type Placement } from "./locate.js";
import { qualify } from "./node-model.js";
import type {
  NodeSetMember,
  NumberKind,
  XPathOutcome,
  XPathProbe,
} from "./query-model.js";
import { clampChars, isProcessingInstruction, piTargetOf } from "./traverse.js";

const namespaceDeclNode = "XmlNamespaceDeclNode";
const documentNode = "XmlDocumentNode";

function numberKindOf(value: number): NumberKind {
  if (Number.isNaN(value)) return "nan";
  if (value === Number.POSITIVE_INFINITY) return "positiveInfinity";
  if (value === Number.NEGATIVE_INFINITY) return "negativeInfinity";
  if (Object.is(value, -0)) return "negativeZero";
  return "finite";
}

function numberOutcome(value: number): XPathOutcome {
  const numberKind = numberKindOf(value);
  switch (numberKind) {
    case "nan":
      return {
        resultType: "number",
        numberKind,
        value: null,
        valueText: "NaN",
      };
    case "positiveInfinity":
      return {
        resultType: "number",
        numberKind,
        value: null,
        valueText: "Infinity",
      };
    case "negativeInfinity":
      return {
        resultType: "number",
        numberKind,
        value: null,
        valueText: "-Infinity",
      };
    case "negativeZero":
      return { resultType: "number", numberKind, value: 0, valueText: "-0" };
    default:
      return {
        resultType: "number",
        numberKind,
        value,
        valueText: String(value),
      };
  }
}

function placementFields(
  placement: Placement,
): Pick<NodeSetMember, "nodeId" | "address" | "unaddressable"> {
  return placement.located
    ? { nodeId: nodeIdOf(placement), address: placement.address }
    : { unaddressable: placement.reason };
}

function valueFields(
  raw: string,
  maxChars: number,
): {
  readonly value: string;
  readonly truncated?: true;
} {
  const value = clampChars(raw, maxChars);
  return value.length === raw.length
    ? { value }
    : { value, truncated: true as const };
}

function memberOf(
  node: XmlNode,
  root: XmlElement,
  maxChars: number,
): NodeSetMember {
  const kindName = node.constructor.name;
  if (kindName === namespaceDeclNode) {
    return { kind: "namespace", unaddressable: "namespace" };
  }
  if (kindName === documentNode) {
    return { kind: "document", unaddressable: "document" };
  }
  if (node instanceof XmlAttribute) {
    const owner = node.parent;
    const placement: Placement =
      owner === null
        ? { located: false, reason: "prolog" }
        : locate(owner, root);
    return {
      kind: "attribute",
      namespaceUri: node.namespaceUri,
      localName: node.name,
      prefixedName: qualify(node.prefix, node.name),
      ...valueFields(node.value, maxChars),
      ...placementFields(placement),
    };
  }

  const placement = locate(node, root);
  const shared = { ...placementFields(placement), line: node.line };
  if (node instanceof XmlElement) {
    return {
      kind: "element",
      namespaceUri: node.namespaceUri,
      localName: node.name,
      prefixedName: qualify(node.prefix, node.name),
      ...shared,
    };
  }
  if (node instanceof XmlEntityReference) {
    return { kind: "entityReference", localName: node.name, ...shared };
  }
  if (node instanceof XmlText) {
    return { kind: "text", ...valueFields(node.content, maxChars), ...shared };
  }
  if (node instanceof XmlCData) {
    return { kind: "cdata", ...valueFields(node.content, maxChars), ...shared };
  }
  if (node instanceof XmlComment) {
    return {
      kind: "comment",
      ...valueFields(node.content, maxChars),
      ...shared,
    };
  }
  if (isProcessingInstruction(node)) {
    return {
      kind: "pi",
      target: piTargetOf(node),
      ...valueFields(node.content, maxChars),
      ...shared,
    };
  }
  throw new Error("unsupported_node_kind");
}

function namespaceMapOf(probe: XPathProbe): Record<string, string> {
  const map: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const binding of probe.bindings) {
    map[binding.prefix] = binding.uri;
  }
  return map;
}

export const compileFailure = "xpath_compile";
export const evaluateFailure = "xpath_eval";

/**
 * The string overloads of eval/find/get compile an XmlXPath internally and
 * dispose it only when evaluation succeeds; a failing expression leaks the
 * compiled object for the life of the worker, measured at one per call and not
 * reclaimed by document disposal. Owning compile and dispose here is the only
 * safe entry point. `get` additionally conflates an empty node-set with null.
 */
export function evaluate(
  document: XmlDocument,
  probe: XPathProbe,
): XPathOutcome {
  let compiled: XmlXPath;
  try {
    compiled = XmlXPath.compile(probe.expression, namespaceMapOf(probe));
  } catch (error) {
    throw new Error(compileFailure, { cause: error });
  }

  let raw: XmlNode[] | string | boolean | number;
  try {
    raw = document.eval(compiled);
  } catch (error) {
    throw new Error(evaluateFailure, { cause: error });
  } finally {
    compiled.dispose();
  }

  if (typeof raw === "boolean") return { resultType: "boolean", value: raw };
  if (typeof raw === "number") return numberOutcome(raw);
  if (typeof raw === "string") {
    return { resultType: "string", ...valueFields(raw, probe.maxChars) };
  }

  const root = document.root;
  const start = Math.min(probe.offset, raw.length);
  const end = Math.min(start + probe.maxResults, raw.length);
  const members: NodeSetMember[] = [];
  for (let index = start; index < end; index += 1) {
    const node = raw[index];
    if (node === undefined) continue;
    members.push(memberOf(node, root, probe.maxChars));
  }
  return {
    resultType: "nodeset",
    members,
    totalMembers: raw.length,
    offset: start,
  };
}
