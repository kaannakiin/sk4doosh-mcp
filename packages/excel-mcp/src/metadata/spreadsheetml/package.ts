import type { OpcPackage, PartSource } from "@sk-mcp/ooxml-core";
import { openOpcPackage } from "./reader.js";
import { namespaces, readXmlPart } from "./xml.js";

export type { OpcPackage, PartSource, Relationship } from "@sk-mcp/ooxml-core";

export interface WorkbookPackage extends OpcPackage {
  readonly sheetParts: ReadonlyMap<string, string>;
  readonly mediaParts: readonly string[];
}

const workbookPath = "xl/workbook.xml";
const mediaPrefix = "xl/media/";

function readSheetParts(opc: OpcPackage): ReadonlyMap<string, string> {
  const sheetParts = new Map<string, string>();
  const workbookXml = opc.part(workbookPath);
  if (workbookXml === undefined) return sheetParts;
  const rels = opc.relationshipsFor(workbookPath);
  readXmlPart(workbookXml, workbookPath, {
    onOpen(node) {
      if (node.uri !== namespaces.spreadsheetml || node.local !== "sheet") {
        return;
      }
      const name = node.attr("name");
      const id = node.attr("id", namespaces.officeRelationships);
      if (name === undefined || id === undefined) return;
      const relationship = rels.get(id);
      if (relationship?.kind === "internal") {
        sheetParts.set(name, relationship.target);
      }
    },
  });
  return sheetParts;
}

/**
 * Opens the package and layers the workbook's own vocabulary over it: the sheet
 * name to part map, and the media parts.
 */
export function openPackage(source: PartSource): WorkbookPackage {
  const opc = openOpcPackage(source);
  const mediaParts = opc.parts
    .map((entry) => entry.path)
    .filter((path) => path.startsWith(mediaPrefix))
    .sort();
  return { ...opc, sheetParts: readSheetParts(opc), mediaParts };
}
