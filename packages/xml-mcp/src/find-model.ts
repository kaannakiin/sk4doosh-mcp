import type { ExpandedName, NodeAddress, NodePath } from "./node-model.js";

export type MatchMode = "contains" | "exact";
export type SearchIn = "text" | "attributes" | "both";
export type MatchKind = "text" | "attribute";

export interface FindProbe {
  readonly query: string;
  readonly matchMode: MatchMode;
  readonly searchIn: SearchIn;
  readonly scopeAddress?: NodeAddress;
  readonly scopePath?: NodePath;
  readonly maxResults: number;
  readonly maxChars: number;
  readonly maxVisits: number;
  readonly resume?: NodePath;
}

export interface FindMatch {
  readonly nodeId: string;
  readonly address: NodeAddress;
  readonly matchKind: MatchKind;
  readonly attribute?: ExpandedName;
  readonly snippet: string;
  readonly snippetTruncated?: true;
}

export interface FindPage {
  readonly matches: readonly FindMatch[];
  readonly scannedCount: number;
  readonly scopeAddress: NodeAddress;
  readonly scopePath: NodePath;
  readonly complete: boolean;
  readonly next?: NodePath;
}
