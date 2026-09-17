export function normalisePartPath(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

/**
 * Resolves a relationship target against the part that declared it. Targets are
 * either absolute in the package ("/xl/tables/table1.xml") or relative to the
 * declaring part's folder ("../drawings/drawing1.xml"), and OPC allows both in
 * the same file.
 *
 * @returns the resolved package path, or undefined when the target climbs above
 * the package root.
 */
export function resolveTarget(
  ownerPath: string,
  target: string,
): string | undefined {
  if (target.startsWith("/")) return target.slice(1);
  const segments = ownerPath.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      /**
       * Guard: popping an empty stack would silently resolve a target that
       * climbs above the root onto a sibling of the package, so the caller
       * would read a part the relationship never named.
       */
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

export function relationshipsPathFor(partPath: string): string {
  const segments = partPath.split("/");
  const name = segments.pop() ?? "";
  return [...segments, "_rels", `${name}.rels`].join("/");
}

export function extensionOf(partPath: string): string {
  const dot = partPath.lastIndexOf(".");
  const slash = partPath.lastIndexOf("/");
  return dot > slash && dot !== -1 ? partPath.slice(dot + 1) : "";
}
