import {
  XmlCData,
  XmlComment,
  XmlElement,
  XmlEntityReference,
  XmlText,
  XmlTreeNode,
  type XmlNode,
} from "libxml2-wasm";
import { XmlProcessingInstructionNode } from "libxml2-wasm/lib/nodes.mjs";
import {
  childIndexOf,
  clark,
  formatNodeId,
  parentIdOf,
  qualify,
  sameName,
  type AttributeRecord,
  type ElementStep,
  type NamespaceBinding,
  type NodeAddress,
  type NodeKind,
  type ContextRecord,
  type NodePath,
  type NodeRecord,
} from "./node-model.js";

/**
 * XmlProcessingInstructionNode extends XmlNode, not XmlTreeNode, so `pi.next` is
 * undefined and a plain `n = n.next` walk ends silently at the first processing
 * instruction — measured: five of seven children lost, no error. The getter only
 * reads the node pointer, so borrowing it off XmlTreeNode.prototype works on every
 * kind. traverse.spec.ts pins this against `find("node()")` as the oracle.
 */
function borrowNextGetter(): (this: XmlNode) => XmlNode | null {
  const getter = Object.getOwnPropertyDescriptor(
    XmlTreeNode.prototype,
    "next",
  )?.get;
  if (getter === undefined) {
    throw new Error("The engine no longer exposes XmlTreeNode.prototype.next.");
  }
  return getter;
}

const readNext = borrowNextGetter();

export function nextSibling(node: XmlNode): XmlNode | undefined {
  return readNext.call(node) ?? undefined;
}

export function firstChildOf(element: XmlElement): XmlNode | undefined {
  return element.firstChild ?? undefined;
}

export function isProcessingInstruction(node: XmlNode): boolean {
  return (
    node instanceof XmlProcessingInstructionNode ||
    node.constructor.name === "XmlProcessingInstructionNode"
  );
}

export function kindOf(node: XmlNode): NodeKind {
  if (node instanceof XmlElement) return "element";
  if (node instanceof XmlText) return "text";
  if (node instanceof XmlCData) return "cdata";
  if (node instanceof XmlComment) return "comment";
  if (node instanceof XmlEntityReference) return "entityReference";
  if (isProcessingInstruction(node)) return "pi";
  throw new Error("unsupported_node_kind");
}

/**
 * The processing-instruction class carries no name accessor, and `content` starts
 * after the target. C14N is the only public surface that reproduces the target.
 */
export function piTargetOf(node: XmlNode): string {
  const serialized = node.canonicalizeToString().trimEnd();
  const body = serialized.startsWith("<?") ? serialized.slice(2) : serialized;
  const end = body.search(/[\s?]/u);
  return end === -1 ? body : body.slice(0, end);
}

function clampChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export function attributesOf(
  element: XmlElement,
  maxChars: number,
): readonly AttributeRecord[] {
  return element.attrs.map((attribute) => {
    const value = clampChars(attribute.value, maxChars);
    return {
      namespaceUri: attribute.namespaceUri,
      localName: attribute.name,
      prefixedName: qualify(attribute.prefix, attribute.name),
      value,
      ...(value.length === attribute.value.length
        ? {}
        : { truncated: true as const }),
    };
  });
}

export function declarationsOf(
  element: XmlElement,
): readonly NamespaceBinding[] {
  return Object.entries(element.nsDeclarations).map(([prefix, uri]) => ({
    prefix,
    uri,
  }));
}

export function stepOf(element: XmlElement, occurrence: number): ElementStep {
  return {
    namespaceUri: element.namespaceUri,
    localName: element.name,
    occurrence,
  };
}

export interface Frame {
  readonly path: NodePath;
  readonly address: NodeAddress;
  readonly relativeDepth: number;
  cursor: XmlNode | undefined;
  childIndex: number;
  readonly occurrences: Map<string, number>;
}

export interface WalkLimits {
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxChars: number;
}

export interface WalkScope {
  readonly element: XmlElement;
  readonly path: NodePath;
  readonly address: NodeAddress;
}

export interface WalkPage {
  readonly records: readonly NodeRecord[];
  readonly context?: readonly ContextRecord[];
  readonly next?: NodePath;
}

function contextOf(stack: readonly Frame[]): readonly ContextRecord[] {
  const entries: ContextRecord[] = [];
  for (const frame of stack) {
    const step = frame.address[frame.address.length - 1];
    if (step === undefined) continue;
    const parentId = parentIdOf(frame.path);
    entries.push({
      nodeId: formatNodeId(frame.path),
      ...(parentId === undefined ? {} : { parentId }),
      depth: frame.path.length - 1,
      namespaceUri: step.namespaceUri,
      localName: step.localName,
      address: frame.address,
    });
  }
  return entries;
}

export function frameFor(
  element: XmlElement,
  path: NodePath,
  address: NodeAddress,
  relativeDepth: number,
): Frame {
  return {
    path,
    address,
    relativeDepth,
    cursor: firstChildOf(element),
    childIndex: 1,
    occurrences: new Map(),
  };
}

function recordFor(
  node: XmlNode,
  path: NodePath,
  address: NodeAddress,
  childrenOmitted: boolean,
  maxChars: number,
): NodeRecord {
  const parentId = parentIdOf(path);
  const base = {
    nodeId: formatNodeId(path),
    ...(parentId === undefined ? {} : { parentId }),
    childIndex: childIndexOf(path),
    depth: path.length - 1,
    line: node.line,
  };
  if (node instanceof XmlElement) {
    const declarations = declarationsOf(node);
    return {
      ...base,
      kind: "element",
      namespaceUri: node.namespaceUri,
      localName: node.name,
      prefixedName: qualify(node.prefix, node.name),
      address,
      attributes: attributesOf(node, maxChars),
      ...(declarations.length === 0
        ? {}
        : { namespaceDeclarations: declarations }),
      ...(childrenOmitted ? { childrenOmitted: true as const } : {}),
    };
  }
  if (node instanceof XmlEntityReference) {
    return { ...base, kind: "entityReference", name: node.name };
  }
  const raw = node.content;
  const value = clampChars(raw, maxChars);
  const truncation =
    value.length === raw.length ? {} : { truncated: true as const };
  if (node instanceof XmlText) {
    return { ...base, kind: "text", value, ...truncation };
  }
  if (node instanceof XmlCData) {
    return { ...base, kind: "cdata", value, ...truncation };
  }
  if (node instanceof XmlComment) {
    return { ...base, kind: "comment", value, ...truncation };
  }
  if (isProcessingInstruction(node)) {
    return {
      ...base,
      kind: "pi",
      target: piTargetOf(node),
      value,
      ...truncation,
    };
  }
  throw new Error("unsupported_node_kind");
}

export function advance(frame: Frame): void {
  const current = frame.cursor;
  if (current === undefined) return;
  frame.cursor = nextSibling(current);
  frame.childIndex += 1;
}

export function descend(scope: WalkScope, resume: NodePath): Frame[] | undefined {
  const stack = [frameFor(scope.element, scope.path, scope.address, 0)];
  for (let level = scope.path.length; level < resume.length; level += 1) {
    const frame = stack[stack.length - 1];
    const target = resume[level];
    if (frame === undefined || target === undefined) return undefined;
    while (frame.cursor !== undefined && frame.childIndex < target) {
      const child = frame.cursor;
      if (child instanceof XmlElement) {
        const key = clark({
          namespaceUri: child.namespaceUri,
          localName: child.name,
        });
        frame.occurrences.set(key, (frame.occurrences.get(key) ?? 0) + 1);
      }
      advance(frame);
    }
    if (frame.cursor === undefined) return undefined;
    if (level === resume.length - 1) return stack;
    const child = frame.cursor;
    if (!(child instanceof XmlElement)) return undefined;
    const key = clark({
      namespaceUri: child.namespaceUri,
      localName: child.name,
    });
    const occurrence = (frame.occurrences.get(key) ?? 0) + 1;
    frame.occurrences.set(key, occurrence);
    const childPath = [...frame.path, frame.childIndex];
    const childAddress = [...frame.address, stepOf(child, occurrence)];
    advance(frame);
    stack.push(
      frameFor(child, childPath, childAddress, frame.relativeDepth + 1),
    );
  }
  return stack;
}

export function walk(
  scope: WalkScope,
  limits: WalkLimits,
  resume?: NodePath,
): WalkPage {
  const records: NodeRecord[] = [];
  let stack: Frame[];
  let context: readonly ContextRecord[] = [];

  if (resume === undefined) {
    const rootHasChildren = firstChildOf(scope.element) !== undefined;
    const omitted = rootHasChildren && limits.maxDepth === 0;
    records.push(
      recordFor(
        scope.element,
        scope.path,
        scope.address,
        omitted,
        limits.maxChars,
      ),
    );
    if (records.length >= limits.maxNodes) {
      const first = firstChildOf(scope.element);
      return first === undefined || omitted
        ? { records }
        : { records, next: [...scope.path, 1] };
    }
    stack = omitted
      ? []
      : [frameFor(scope.element, scope.path, scope.address, 0)];
  } else {
    const rebuilt = descend(scope, resume);
    if (rebuilt === undefined) return { records };
    stack = rebuilt;
    context = contextOf(rebuilt);
  }

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const child = frame.cursor;
    if (child === undefined) {
      stack.pop();
      continue;
    }
    const path = [...frame.path, frame.childIndex];
    const isElement = child instanceof XmlElement;
    let address = frame.address;
    if (isElement) {
      const key = clark({
        namespaceUri: child.namespaceUri,
        localName: child.name,
      });
      const occurrence = (frame.occurrences.get(key) ?? 0) + 1;
      frame.occurrences.set(key, occurrence);
      address = [...frame.address, stepOf(child, occurrence)];
    }
    const canDescend = isElement && frame.relativeDepth + 1 < limits.maxDepth;
    const omitted =
      isElement && !canDescend && firstChildOf(child) !== undefined;

    records.push(recordFor(child, path, address, omitted, limits.maxChars));
    advance(frame);

    if (canDescend) {
      stack.push(frameFor(child, path, address, frame.relativeDepth + 1));
    }

    if (records.length >= limits.maxNodes) {
      const next = nextUnvisited(stack);
      return {
        records,
        ...(context.length === 0 ? {} : { context }),
        ...(next === undefined ? {} : { next }),
      };
    }
  }

  return { records, ...(context.length === 0 ? {} : { context }) };
}

export function nextUnvisited(stack: readonly Frame[]): NodePath | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    if (frame?.cursor !== undefined) {
      return [...frame.path, frame.childIndex];
    }
  }
  return undefined;
}

export function resolveAddress(
  root: XmlElement,
  address: NodeAddress,
): WalkScope | undefined {
  const first = address[0];
  if (first === undefined) {
    return { element: root, path: [1], address: [stepOf(root, 1)] };
  }
  if (
    !sameName(first, { namespaceUri: root.namespaceUri, localName: root.name })
  )
    return undefined;
  if (first.occurrence !== 1) return undefined;

  let element = root;
  let path: NodePath = [1];
  let resolved: NodeAddress = [stepOf(root, 1)];

  for (let level = 1; level < address.length; level += 1) {
    const step = address[level];
    if (step === undefined) return undefined;
    let cursor = firstChildOf(element);
    let childIndex = 1;
    let seen = 0;
    let found: XmlElement | undefined;
    let foundIndex = 0;
    while (cursor !== undefined) {
      if (cursor instanceof XmlElement) {
        if (
          sameName(step, {
            namespaceUri: cursor.namespaceUri,
            localName: cursor.name,
          })
        ) {
          seen += 1;
          if (seen === step.occurrence) {
            found = cursor;
            foundIndex = childIndex;
            break;
          }
        }
      }
      cursor = nextSibling(cursor);
      childIndex += 1;
    }
    if (found === undefined) return undefined;
    element = found;
    path = [...path, foundIndex];
    resolved = [...resolved, stepOf(found, step.occurrence)];
  }

  return { element, path, address: resolved };
}

export function resolveScopePath(
  root: XmlElement,
  path: NodePath,
): WalkScope | undefined {
  if (path[0] !== 1) return undefined;
  let element = root;
  let walked: NodePath = [1];
  let address: NodeAddress = [stepOf(root, 1)];

  for (let level = 1; level < path.length; level += 1) {
    const target = path[level];
    if (target === undefined) return undefined;
    const occurrences = new Map<string, number>();
    let cursor = firstChildOf(element);
    let childIndex = 1;
    let found: XmlElement | undefined;
    let occurrence = 0;
    while (cursor !== undefined) {
      if (cursor instanceof XmlElement) {
        const key = clark({
          namespaceUri: cursor.namespaceUri,
          localName: cursor.name,
        });
        const seen = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, seen);
        if (childIndex === target) {
          found = cursor;
          occurrence = seen;
          break;
        }
      } else if (childIndex === target) {
        return undefined;
      }
      cursor = nextSibling(cursor);
      childIndex += 1;
    }
    if (found === undefined) return undefined;
    element = found;
    walked = [...walked, target];
    address = [...address, stepOf(found, occurrence)];
  }

  return { element, path: walked, address };
}
