export type ColumnKind =
  | "boolean"
  | "integer"
  | "bigint"
  | "decimal"
  | "float"
  | "text"
  | "binary"
  | "uuid"
  | "json"
  | "xml"
  | "date"
  | "time"
  | "timestamp"
  | "timestamptz"
  | "unknown";

export type JsonScalar = string | number | boolean | null;

/** The engine's own type facts for one column, before classification. */
export interface NativeColumn {
  readonly typeName: string;
  readonly maxLength?: number;
  readonly precision?: number;
  readonly scale?: number;
}

export interface ColumnDescriptor {
  readonly name: string;
  readonly ordinal: number;
  readonly kind: ColumnKind;
  /**
   * The engine's own type name, verbatim: this is the one place engine
   * vocabulary appears in db-core, as data flowing through rather than as a
   * literal in the source.
   */
  readonly nativeType: string;
  readonly nullable: boolean;
  readonly maxLength?: number;
  readonly precision?: number;
  readonly scale?: number;
}

export interface ValuePolicy {
  readonly maxTextChars: number;
  readonly maxBinaryBytes: number;
}

export interface EncodedValue {
  readonly value: JsonScalar;
  readonly truncated?: true;
}
