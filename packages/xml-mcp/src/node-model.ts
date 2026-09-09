export type NodeKind =
  "element" | "text" | "cdata" | "comment" | "pi" | "entityReference";

export interface ExpandedName {
  readonly namespaceUri: string;
  readonly localName: string;
}

export interface ElementStep extends ExpandedName {
  readonly occurrence: number;
}

export type NodeAddress = readonly ElementStep[];

export type NodePath = readonly number[];

export interface NamespaceBinding {
  readonly prefix: string;
  readonly uri: string;
}

export interface AttributeRecord extends ExpandedName {
  readonly prefixedName: string;
  readonly value: string;
  readonly truncated?: true;
}

interface RecordBase {
  readonly nodeId: string;
  readonly parentId?: string;
  readonly childIndex: number;
  readonly depth: number;
  readonly line?: number;
}

export interface ElementRecord extends RecordBase {
  readonly kind: "element";
  readonly namespaceUri: string;
  readonly localName: string;
  readonly prefixedName: string;
  readonly address: NodeAddress;
  readonly attributes: readonly AttributeRecord[];
  readonly namespaceDeclarations?: readonly NamespaceBinding[];
  readonly childrenOmitted?: true;
}

export interface CharacterRecord extends RecordBase {
  readonly kind: "text" | "cdata" | "comment";
  readonly value: string;
  readonly truncated?: true;
}

export interface ProcessingInstructionRecord extends RecordBase {
  readonly kind: "pi";
  readonly target: string;
  readonly value: string;
  readonly truncated?: true;
}

export interface EntityReferenceRecord extends RecordBase {
  readonly kind: "entityReference";
  readonly name: string;
}

export interface ContextRecord {
  readonly nodeId: string;
  readonly parentId?: string;
  readonly depth: number;
  readonly namespaceUri: string;
  readonly localName: string;
  readonly address: NodeAddress;
}

export type NodeRecord =
  | ElementRecord
  | CharacterRecord
  | ProcessingInstructionRecord
  | EntityReferenceRecord;

export function clark(name: ExpandedName): string {
  return name.namespaceUri === ""
    ? name.localName
    : `{${name.namespaceUri}}${name.localName}`;
}

export function qualify(prefix: string, localName: string): string {
  return prefix === "" ? localName : `${prefix}:${localName}`;
}

export function formatNodeId(path: NodePath): string {
  return path.join(".");
}

export function parseNodeId(raw: string): NodePath | undefined {
  if (!/^[1-9][0-9]*(\.[1-9][0-9]*)*$/u.test(raw)) return undefined;
  return raw.split(".").map(Number);
}

export function parentIdOf(path: NodePath): string | undefined {
  return path.length <= 1 ? undefined : formatNodeId(path.slice(0, -1));
}

export function childIndexOf(path: NodePath): number {
  return path[path.length - 1] ?? 1;
}

export function sameName(left: ExpandedName, right: ExpandedName): boolean {
  return (
    left.namespaceUri === right.namespaceUri &&
    left.localName === right.localName
  );
}

export function formatAddress(address: NodeAddress): string {
  return address
    .map((step) =>
      step.occurrence === 1
        ? clark(step)
        : `${clark(step)}[${String(step.occurrence)}]`,
    )
    .join("/");
}
