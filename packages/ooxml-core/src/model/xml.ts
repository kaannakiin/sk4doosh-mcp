export interface XmlNode {
  readonly local: string;
  readonly uri: string;
  attr(name: string, uri?: string): string | undefined;
}

export interface XmlVisitor {
  readonly onOpen?: (node: XmlNode) => void;
  readonly onClose?: (local: string, uri: string) => void;
  readonly onText?: (text: string) => void;
}
