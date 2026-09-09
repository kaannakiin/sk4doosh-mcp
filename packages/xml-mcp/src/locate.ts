import {
  XmlAttribute,
  XmlElement,
  XmlTreeNode,
  type XmlNode,
} from "libxml2-wasm";
import {
  clark,
  formatNodeId,
  type ElementStep,
  type NodeAddress,
  type NodePath,
} from "./node-model.js";
import { stepOf } from "./traverse.js";
import type { Unaddressable } from "./query-model.js";

/**
 * Mirrors traverse.ts's borrow of `next`: the processing-instruction class
 * extends XmlNode, not XmlTreeNode, so `pi.prev` is undefined and a plain
 * backwards walk silently stops counting at the first one. The getter only
 * reads the node pointer, so it is valid on every kind.
 */
function borrowPrevGetter(): (this: XmlNode) => XmlNode | null {
  const getter = Object.getOwnPropertyDescriptor(
    XmlTreeNode.prototype,
    "prev",
  )?.get;
  if (getter === undefined) {
    throw new Error("The engine no longer exposes XmlTreeNode.prototype.prev.");
  }
  return getter;
}

const readPrev = borrowPrevGetter();

export function previousSibling(node: XmlNode): XmlNode | undefined {
  return readPrev.call(node) ?? undefined;
}

export interface Position {
  readonly path: NodePath;
  readonly address: NodeAddress;
}

export type Placement =
  | ({ readonly located: true } & Position)
  | { readonly located: false; readonly reason: Unaddressable };

interface Rung {
  readonly childIndex: number;
  readonly step?: ElementStep;
}

function rungOf(node: XmlNode): Rung {
  const name =
    node instanceof XmlElement
      ? clark({ namespaceUri: node.namespaceUri, localName: node.name })
      : undefined;
  let childIndex = 1;
  let occurrence = 1;
  for (
    let sibling = previousSibling(node);
    sibling !== undefined;
    sibling = previousSibling(sibling)
  ) {
    childIndex += 1;
    if (
      name !== undefined &&
      sibling instanceof XmlElement &&
      clark({ namespaceUri: sibling.namespaceUri, localName: sibling.name }) ===
        name
    ) {
      occurrence += 1;
    }
  }
  return node instanceof XmlElement
    ? { childIndex, step: stepOf(node, occurrence) }
    : { childIndex };
}

/**
 * A prolog comment or processing instruction reports a null parent exactly like
 * the document element does, so the walk cannot tell them apart by shape: the
 * root identity check is what separates an addressable chain from an
 * unreachable one.
 */
export function locate(node: XmlNode, root: XmlElement): Placement {
  /**
   * `prev` on an attribute walks the attribute list, not the child list, so an
   * attribute reaching this walk would be given a sibling index that means
   * nothing. Callers address the owner element and attach the attribute name.
   */
  if (node instanceof XmlAttribute) {
    throw new Error("locate_received_attribute");
  }

  const rungs: Rung[] = [];
  let current: XmlNode = node;

  for (let depth = 0; depth <= 2048; depth += 1) {
    const parent = current.parent;
    if (parent === null) {
      if (!current.isSameNode(root)) {
        return { located: false, reason: "prolog" };
      }
      const path: number[] = [1];
      const address: ElementStep[] = [stepOf(root, 1)];
      for (let index = rungs.length - 1; index >= 0; index -= 1) {
        const rung = rungs[index];
        if (rung === undefined) continue;
        path.push(rung.childIndex);
        if (rung.step !== undefined) address.push(rung.step);
      }
      return { located: true, path, address };
    }
    rungs.push(rungOf(current));
    current = parent;
  }

  return { located: false, reason: "prolog" };
}

export function nodeIdOf(position: Position): string {
  return formatNodeId(position.path);
}
