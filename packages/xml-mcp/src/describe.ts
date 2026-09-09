import { XmlDocument, XmlElement } from "libxml2-wasm";
import {
  clark,
  qualify,
  type ExpandedName,
  type NodeAddress,
} from "./node-model.js";
import { surveyNamespaces, type NamespaceAlias } from "./namespaces.js";
import { firstChildOf, nextSibling, stepOf } from "./traverse.js";

export interface RootFacts {
  readonly localName: string;
  readonly namespaceUri: string;
  readonly prefixedName: string;
}

export interface StructureFacts {
  readonly elementCount: number;
  readonly elementCountExact: boolean;
  readonly maxDepth: number;
  readonly maxDepthExact: boolean;
}

export interface RepetitionCandidate extends ExpandedName {
  readonly address: NodeAddress;
  readonly count: number;
  readonly countExact: boolean;
}

export interface DescribeFacts {
  readonly root: RootFacts;
  readonly rootAddress: NodeAddress;
  readonly declaredEncoding: string | null;
  readonly warningCount: number;
  readonly namespaces: readonly NamespaceAlias[];
  readonly namespacesComplete: boolean;
  readonly structure: StructureFacts;
  readonly repetitionCandidates: readonly RepetitionCandidate[];
  readonly mixedContent: readonly NodeAddress[];
  readonly exampleAddress: NodeAddress;
}

export function rootFactsOf(document: XmlDocument): RootFacts {
  const root = document.root;
  return {
    localName: root.name,
    namespaceUri: root.namespaceUri,
    prefixedName: qualify(root.prefix, root.name),
  };
}

interface Signature {
  count: number;
  readonly address: NodeAddress;
  readonly name: ExpandedName;
}

interface Pending {
  readonly element: XmlElement;
  readonly address: NodeAddress;
  readonly signature: string;
  readonly depth: number;
}

function classify(element: XmlElement): {
  readonly children: readonly XmlElement[];
  readonly mixed: boolean;
} {
  const children: XmlElement[] = [];
  let text = false;
  for (
    let child = firstChildOf(element);
    child !== undefined;
    child = nextSibling(child)
  ) {
    if (child instanceof XmlElement) {
      children.push(child);
    } else if (child.content.trim() !== "") {
      text = true;
    }
  }
  return { children, mixed: text && children.length > 0 };
}

export function describeDocument(
  document: XmlDocument,
  maxVisits: number,
  maxCandidates: number,
): DescribeFacts {
  const root = document.root;
  const rootAddress: NodeAddress = [stepOf(root, 1)];
  const survey = surveyNamespaces(root, maxVisits);

  const signatures = new Map<string, Signature>();
  const mixedContent: NodeAddress[] = [];
  const stack: Pending[] = [
    {
      element: root,
      address: rootAddress,
      signature: clark(rootFactsOf(document)),
      depth: 0,
    },
  ];

  let elementCount = 0;
  let maxDepth = 0;
  let complete = true;

  while (stack.length > 0) {
    const pending = stack.pop();
    if (pending === undefined) break;
    if (elementCount >= maxVisits) {
      complete = false;
      break;
    }
    elementCount += 1;
    maxDepth = Math.max(maxDepth, pending.depth);

    const existing = signatures.get(pending.signature);
    if (existing === undefined) {
      signatures.set(pending.signature, {
        count: 1,
        address: pending.address,
        name: {
          namespaceUri: pending.element.namespaceUri,
          localName: pending.element.name,
        },
      });
    } else {
      existing.count += 1;
    }

    const { children, mixed } = classify(pending.element);
    if (mixed && mixedContent.length < maxCandidates) {
      mixedContent.push(pending.address);
    }

    const occurrences = new Map<string, number>();
    const queued: Pending[] = [];
    for (const child of children) {
      const key = clark({
        namespaceUri: child.namespaceUri,
        localName: child.name,
      });
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      queued.push({
        element: child,
        address: [...pending.address, stepOf(child, occurrence)],
        signature: `${pending.signature}/${key}`,
        depth: pending.depth + 1,
      });
    }
    for (let index = queued.length - 1; index >= 0; index -= 1) {
      const child = queued[index];
      if (child !== undefined) stack.push(child);
    }
  }

  const repetitionCandidates = [...signatures.values()]
    .filter((signature) => signature.count > 1)
    .sort((left, right) => right.count - left.count)
    .slice(0, maxCandidates)
    .map((signature) => ({
      namespaceUri: signature.name.namespaceUri,
      localName: signature.name.localName,
      address: signature.address,
      count: signature.count,
      countExact: complete,
    }));

  const example = repetitionCandidates[0]?.address ?? rootAddress;

  return {
    root: rootFactsOf(document),
    rootAddress,
    declaredEncoding: document.encoding ?? null,
    warningCount: document.warnings.length,
    namespaces: survey.aliases,
    namespacesComplete: survey.complete,
    structure: {
      elementCount,
      elementCountExact: complete,
      maxDepth,
      maxDepthExact: complete,
    },
    repetitionCandidates,
    mixedContent,
    exampleAddress: example,
  };
}
