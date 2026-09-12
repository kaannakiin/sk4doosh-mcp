import { SaxesParser, type SaxesAttributeNS } from "saxes";
import { SkMcpExcelError } from "../errors.js";

export const namespaces = {
  spreadsheetml: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  officeRelationships:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  packageRelationships:
    "http://schemas.openxmlformats.org/package/2006/relationships",
  spreadsheetDrawing:
    "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  drawing: "http://schemas.openxmlformats.org/drawingml/2006/main",
} as const;

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

function nodeFor(
  local: string,
  uri: string,
  attributes: Readonly<Record<string, SaxesAttributeNS>>,
): XmlNode {
  return {
    local,
    uri,
    attr(name, wanted = "") {
      for (const key in attributes) {
        if (!Object.hasOwn(attributes, key)) continue;
        const attribute = attributes[key];
        if (attribute === undefined) continue;
        if (attribute.local === name && attribute.uri === wanted) {
          return attribute.value;
        }
      }
      return undefined;
    },
  };
}

const namespaceAware = { xmlns: true } as const;

/**
 * Reads one OPC part. `xmlns: true` is what makes every caller match on
 * `(uri, local)` instead of the literal tag name, so a part written with a
 * namespace prefix — `<x:dataValidation>`, which every .NET writer emits — is
 * indistinguishable from the unprefixed form at the call site. Matching on the
 * spelled tag is the defect this reader exists to avoid.
 *
 * A DOCTYPE is refused rather than parsed: ECMA-376 Part 2 forbids a DTD in an
 * OPC part, so its presence means the bytes are not the part they claim to be,
 * and refusing keeps entity resolution off the table entirely.
 */
export function readXmlPart(
  xml: string,
  partName: string,
  visitor: XmlVisitor,
): void {
  const parser = new SaxesParser<typeof namespaceAware>(namespaceAware);
  let failure: string | undefined;
  parser.on("error", (error) => {
    failure ??= error.message;
  });
  parser.on("doctype", () => {
    failure ??= "the part declares a DOCTYPE, which OPC forbids";
  });
  if (visitor.onOpen !== undefined) {
    const onOpen = visitor.onOpen;
    parser.on("opentag", (tag) => {
      if (failure !== undefined) return;
      onOpen(nodeFor(tag.local, tag.uri, tag.attributes));
    });
  }
  if (visitor.onClose !== undefined) {
    const onClose = visitor.onClose;
    parser.on("closetag", (tag) => {
      if (failure !== undefined) return;
      onClose(tag.local, tag.uri);
    });
  }
  if (visitor.onText !== undefined) {
    const onText = visitor.onText;
    parser.on("text", (text) => {
      if (failure !== undefined) return;
      onText(text);
    });
  }
  try {
    parser.write(xml).close();
  } catch (error) {
    failure ??= error instanceof Error ? error.message : String(error);
  }
  if (failure !== undefined) {
    throw new SkMcpExcelError(
      "corrupt_workbook",
      `'${partName}' is not well-formed XML: ${failure}`,
      "Open the file in Excel and re-save it as .xlsx.",
    );
  }
}
