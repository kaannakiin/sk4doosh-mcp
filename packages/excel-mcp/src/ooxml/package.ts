import type * as XLSX from "@e965/xlsx";
import type {
  OpcPackage,
  PartEntry,
  PartSource,
} from "@sk-mcp/ooxml-core";
import { openOpcPackage } from "./reader.js";

import { namespaces, readXmlPart } from "./xml.js";

export type { OpcPackage, PartSource, Relationship } from "@sk-mcp/ooxml-core";

export interface WorkbookPackage extends OpcPackage {
  readonly sheetParts: ReadonlyMap<string, string>;
  readonly mediaParts: readonly string[];
}

interface RawFile {
  readonly content?: unknown;
  readonly size?: number;
}

function rawBytes(content: unknown): Uint8Array | undefined {
  if (content instanceof Uint8Array) return content;
  if (typeof content === "string") return Buffer.from(content, "utf8");
  return undefined;
}

/**
 * Guard: SheetJS attaches its decompressed entry table to the workbook under an
 * undeclared `files` property, reachable only through a cast, and injects its
 * own "\u0001Sh33tJ5" sentinel into it. That key is not an archive entry, so a
 * name carrying a control character is skipped and this stays a faithful view
 * of the container. This exists so the zip reader can be compared against
 * SheetJS's own over every fixture workbook; it is not the path the server takes.
 */
export function sheetJsSource(book: XLSX.WorkBook): PartSource {
  const files =
    (book as unknown as { files?: Record<string, RawFile> }).files ?? {};
  const entries: PartEntry[] = [];
  for (const [path, file] of Object.entries(files)) {
    if (path.endsWith("/")) continue;
    if ((path.codePointAt(0) ?? 0) < 0x20) continue;
    const bytes = rawBytes(file.content);
    if (bytes === undefined) continue;
    entries.push({ path, sizeBytes: file.size ?? bytes.length });
  }
  return {
    entries,
    read: (path) => rawBytes(files[path]?.content),
  };
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
