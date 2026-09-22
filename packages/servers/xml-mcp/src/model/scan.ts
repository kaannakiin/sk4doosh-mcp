import type { ExpandedName } from "./node.js";

export interface NamespaceDeclaration {
  readonly prefix: string;
  readonly uri: string;
  readonly source: string;
}

export interface InheritedContext {
  readonly namespaces: readonly NamespaceDeclaration[];
  readonly lang?: string;
  readonly base?: string;
  readonly space?: string;
}

export type ScanRefusal =
  | { readonly reason: "not_record_shaped" }
  | {
      readonly reason: "record_too_large";
      readonly occurrence: number;
      readonly bytes: number;
    }
  | { readonly reason: "utf16" }
  | { readonly reason: "unsupported_encoding"; readonly declared: string }
  | { readonly reason: "malformed"; readonly offset: number };

export interface BoundaryScan {
  readonly context: InheritedContext;
  readonly offsets: Float64Array;
  readonly firstOrdinal: number;
  readonly scanned: number;
  readonly complete: boolean;
  readonly resumedFromHint: boolean;
}

export interface ScanResume {
  readonly byte: number;
  readonly ordinal: number;
}

export interface ScanOptions {
  readonly maxRecordBytes: number;
  readonly maxSpans: number;
  readonly from?: ScanResume;
}

export interface ShapeCandidate {
  readonly name: ExpandedName;
  readonly count: number;
}

export interface SurveyedRoot {
  readonly localName: string;
  readonly namespaceUri: string;
  readonly prefixedName: string;
}

export interface ShapeSurvey {
  readonly root: SurveyedRoot | undefined;
  readonly namespaces: readonly NamespaceDeclaration[];
  readonly candidates: readonly ShapeCandidate[];
  readonly elementCount: number;
  readonly maxDepth: number;
  readonly complete: boolean;
}
