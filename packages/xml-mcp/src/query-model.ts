import type {
  ExpandedName,
  NamespaceBinding,
  NodeAddress,
} from "./node-model.js";

export type MemberKind =
  | "element"
  | "attribute"
  | "text"
  | "cdata"
  | "comment"
  | "pi"
  | "entityReference"
  | "namespace"
  | "document";

export type Unaddressable = "prolog" | "namespace" | "document";

interface MemberBase {
  readonly nodeId?: string;
  readonly address?: NodeAddress;
  readonly unaddressable?: Unaddressable;
  readonly line?: number;
}

interface ValueBearing {
  readonly value: string;
  readonly truncated?: true;
}

export type NodeSetMember =
  | (MemberBase & {
      readonly kind: "element";
      readonly namespaceUri: string;
      readonly localName: string;
      readonly prefixedName: string;
    })
  | (MemberBase &
      ValueBearing & {
        readonly kind: "attribute";
        readonly namespaceUri: string;
        readonly localName: string;
        readonly prefixedName: string;
      })
  | (MemberBase &
      ValueBearing & { readonly kind: "text" | "cdata" | "comment" })
  | (MemberBase &
      ValueBearing & { readonly kind: "pi"; readonly target: string })
  | (MemberBase & {
      readonly kind: "entityReference";
      readonly localName: string;
    })
  | (MemberBase & { readonly kind: "namespace" | "document" });

export type NumberKind =
  "finite" | "negativeZero" | "nan" | "positiveInfinity" | "negativeInfinity";

export interface XPathProbe {
  readonly expression: string;
  readonly bindings: readonly NamespaceBinding[];
  readonly offset: number;
  readonly maxResults: number;
  readonly maxChars: number;
}

export type XPathOutcome =
  | {
      readonly resultType: "nodeset";
      readonly members: readonly NodeSetMember[];
      readonly totalMembers: number;
      readonly offset: number;
    }
  | {
      readonly resultType: "string";
      readonly value: string;
      readonly truncated?: true;
    }
  | { readonly resultType: "boolean"; readonly value: boolean }
  | {
      readonly resultType: "number";
      readonly numberKind: NumberKind;
      readonly value: number | null;
      readonly valueText: string;
    };

export interface ItemSelector {
  readonly ancestors: NodeAddress;
  readonly name: ExpandedName;
}

export type ColumnSource =
  | { readonly from: "text" }
  | { readonly from: "attribute"; readonly attribute: ExpandedName }
  | { readonly from: "name" };

export type MultiplePolicy = "error" | "list" | "first";

export interface ColumnSpec {
  readonly label: string;
  readonly ancestors: NodeAddress;
  readonly name?: ExpandedName;
  readonly source: ColumnSource;
  readonly onMultiple: MultiplePolicy;
}

export type Cell =
  | {
      readonly status: "present";
      readonly value: string;
      readonly truncated?: true;
      readonly mixed?: true;
    }
  | { readonly status: "empty"; readonly mixed?: true }
  | { readonly status: "missing" }
  | { readonly status: "multiple"; readonly count: number }
  | {
      readonly status: "list";
      readonly values: readonly string[];
      readonly count: number;
      readonly truncated?: true;
    };

export type ConditionOp =
  | "eq"
  | "ne"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "in"
  | "isEmpty"
  | "isNotEmpty"
  | "isMissing"
  | "isPresent";

export interface Condition {
  readonly column: number;
  readonly op: ConditionOp;
  readonly value?: string;
  readonly values?: readonly string[];
}

export type MatchMode = "all" | "any";

export interface ScanLimits {
  readonly maxItemVisits: number;
  readonly maxChars: number;
  readonly maxCellValues: number;
}

export interface RecordProbe extends ScanLimits {
  readonly item: ItemSelector;
  readonly columns: readonly ColumnSpec[];
  readonly where: readonly Condition[];
  readonly match: MatchMode;
  readonly caseSensitive: boolean;
  readonly offset: number;
  readonly maxRows: number;
}

export interface Row {
  readonly nodeId: string;
  readonly occurrence: number;
  readonly cells: readonly Cell[];
}

export interface ColumnReport {
  readonly label: string;
  readonly missingCount: number;
  readonly emptyCount: number;
  readonly multipleCount: number;
  readonly mixedCount: number;
}

interface ItemScope {
  readonly itemParentAddress: NodeAddress;
  readonly itemName: ExpandedName;
  readonly scannedItems: number;
  readonly matchedItems: number;
  readonly totalItems: number;
  readonly totalItemsExact: boolean;
}

export interface RecordPage extends ItemScope {
  readonly rows: readonly Row[];
  readonly columns: readonly ColumnReport[];
  readonly complete: boolean;
  readonly next?: number;
}

export type MetricFunction =
  "count" | "countValues" | "countDistinct" | "sum" | "avg" | "min" | "max";

export interface MetricRequest {
  readonly fn: MetricFunction;
  readonly column?: number;
}

export type NumericMode = "off" | "binary64";

export type MetricOrder = "group" | "metric";

export interface AggregateProbe extends ScanLimits {
  readonly item: ItemSelector;
  readonly columns: readonly ColumnSpec[];
  readonly groupBy: readonly number[];
  readonly metrics: readonly MetricRequest[];
  readonly where: readonly Condition[];
  readonly match: MatchMode;
  readonly caseSensitive: boolean;
  readonly numericMode: NumericMode;
  readonly orderBy: MetricOrder;
  readonly orderByMetric: number;
  readonly descending: boolean;
  readonly maxGroups: number;
}

export type MetricValue =
  | { readonly kind: "count"; readonly value: number }
  | {
      readonly kind: "number";
      readonly value: number;
      readonly valueText: string;
      readonly negativeZero?: true;
      readonly counted: number;
      readonly skipped: number;
      readonly rounded: number;
    }
  | {
      readonly kind: "undefined";
      readonly counted: 0;
      readonly skipped: number;
    };

export interface GroupResult {
  readonly key: readonly Cell[];
  readonly rows: number;
  readonly metrics: readonly MetricValue[];
}

export interface AggregateOutcome extends ItemScope {
  readonly groups: readonly GroupResult[];
  readonly columns: readonly ColumnReport[];
  readonly groupCount: number;
  readonly returnedMatchedItems: number;
  readonly complete: boolean;
  readonly groupsTruncated: boolean;
}
