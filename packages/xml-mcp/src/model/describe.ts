import type { ExpandedName, NodeAddress } from "./node.js";

export interface NamespaceAlias {
  readonly uri: string;
  readonly alias: string;
  readonly declaredPrefixes: readonly string[];
  readonly synthetic: boolean;
}

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
