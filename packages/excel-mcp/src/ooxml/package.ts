import type * as XLSX from "@e965/xlsx";
import { namespaces, readXmlPart } from "./xml.js";

export interface OpcPackage {
  part(path: string): string | undefined;
  partSize(path: string): number | undefined;
  relationshipsFor(partPath: string): ReadonlyMap<string, Relationship>;
  readonly sheetParts: ReadonlyMap<string, string>;
  readonly mediaParts: readonly string[];
}

export interface Relationship {
  readonly target: string;
  readonly external: boolean;
}

interface RawFile {
  readonly content?: unknown;
  readonly size?: number;
}

function decode(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array)
    return Buffer.from(content).toString("utf8");
  return undefined;
}

function normalise(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

/**
 * Resolves a relationship Target against the part that declared it. Targets are
 * either absolute in the package ("/xl/tables/table1.xml") or relative to the
 * declaring part's folder ("../drawings/drawing1.xml"), and OPC allows both in
 * the same file.
 */
function resolveTarget(ownerPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = ownerPath.split("/").slice(0, -1);
  const segments: string[] = [...base];
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function relationshipsPathFor(partPath: string): string {
  const segments = partPath.split("/");
  const name = segments.pop() ?? "";
  return [...segments, "_rels", `${name}.rels`].join("/");
}

/**
 * Reads the package through SheetJS's own zip so no second unzip implementation
 * enters the tree. `bookFiles: true` retains every part decompressed, which is
 * why callers take what they need at parse time and drop the workbook handle
 * rather than caching it.
 */
export function openPackage(book: XLSX.WorkBook): OpcPackage {
  const files = (book as unknown as { files?: Record<string, RawFile> }).files;
  const relationshipCache = new Map<
    string,
    ReadonlyMap<string, Relationship>
  >();

  const part = (path: string): string | undefined =>
    decode(files?.[normalise(path)]?.content);

  const partSize = (path: string): number | undefined =>
    files?.[normalise(path)]?.size;

  const relationshipsFor = (
    partPath: string,
  ): ReadonlyMap<string, Relationship> => {
    const owner = normalise(partPath);
    const cached = relationshipCache.get(owner);
    if (cached !== undefined) return cached;
    const resolved = new Map<string, Relationship>();
    const xml = part(relationshipsPathFor(owner));
    if (xml !== undefined) {
      readXmlPart(xml, relationshipsPathFor(owner), {
        onOpen(node) {
          if (
            node.uri !== namespaces.packageRelationships ||
            node.local !== "Relationship"
          ) {
            return;
          }
          const id = node.attr("Id");
          const target = node.attr("Target");
          if (id === undefined || target === undefined) return;
          /**
           * An external target is a URL, not a package path; resolving it
           * against the owning part would mangle it, so it is kept verbatim
           * and flagged for the caller.
           */
          if (node.attr("TargetMode") === "External") {
            resolved.set(id, { target, external: true });
            return;
          }
          resolved.set(id, {
            target: resolveTarget(owner, target),
            external: false,
          });
        },
      });
    }
    relationshipCache.set(owner, resolved);
    return resolved;
  };

  const sheetParts = new Map<string, string>();
  const workbookPath = "xl/workbook.xml";
  const workbookXml = part(workbookPath);
  if (workbookXml !== undefined) {
    const rels = relationshipsFor(workbookPath);
    readXmlPart(workbookXml, workbookPath, {
      onOpen(node) {
        if (node.uri !== namespaces.spreadsheetml || node.local !== "sheet") {
          return;
        }
        const name = node.attr("name");
        const id = node.attr("id", namespaces.officeRelationships);
        if (name === undefined || id === undefined) return;
        const relationship = rels.get(id);
        if (relationship !== undefined && !relationship.external) {
          sheetParts.set(name, relationship.target);
        }
      },
    });
  }

  const mediaParts = Object.keys(files ?? {})
    .filter((name) => name.startsWith("xl/media/") && name !== "xl/media/")
    .sort();

  return { part, partSize, relationshipsFor, sheetParts, mediaParts };
}
