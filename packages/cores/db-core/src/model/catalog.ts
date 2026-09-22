import type { ColumnDescriptor } from "./value.js";

export type ObjectKind = "table" | "view";

export interface TableRef {
  readonly schema: string;
  readonly name: string;
}

export interface TableEntry extends TableRef {
  readonly kind: ObjectKind;
}

export type KeyKind = "primary" | "unique" | "foreign";

export interface KeyEntry {
  readonly name: string;
  readonly kind: KeyKind;
  readonly columns: readonly string[];
  readonly referencedSchema?: string;
  readonly referencedTable?: string;
  readonly referencedColumns?: readonly string[];
}

export interface ServerFacts {
  readonly engineVersion: string;
  readonly catalog: string;
  readonly principal: string;
}

export interface IntrospectionScope {
  readonly schema?: string;
  readonly namePattern?: string;
  readonly includeViews: boolean;
  readonly maxResults: number;
}

export interface TableDescription extends TableRef {
  readonly kind: ObjectKind;
  readonly columns: readonly ColumnDescriptor[];
  readonly keys: readonly KeyEntry[];
}
