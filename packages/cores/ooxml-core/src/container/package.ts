import type { OoxmlLimits } from "../limits.js";
import type { OoxmlErrorFactory } from "../model/errors.js";
import type { OpcPackage, PartSource, Relationship } from "../model/package.js";
import { declaredEncodingOf, decodePart } from "../primitives/bytes.js";
import type { XmlPartReader } from "../xml/read.js";
import { contentTypesPath, readContentTypes } from "./content-types.js";
import { normalisePartPath, relationshipsPathFor } from "./names.js";
import { readRelationships } from "./relationships.js";

export interface PackageEnvironment {
  readonly fail: OoxmlErrorFactory;
  readonly limits: OoxmlLimits;
  readonly readXmlPart: XmlPartReader;
}

/**
 * Opens an OPC package over a part source.
 *
 * @param source the container's parts, already indexed.
 * @param environment the error factory, the ceilings and the part reader.
 * @returns the package, with decoded part text memoised.
 */
export function openPackage(
  source: PartSource,
  environment: PackageEnvironment,
): OpcPackage {
  const { fail, limits, readXmlPart } = environment;
  const sizes = new Map(
    source.entries.map((entry) => [entry.path, entry.sizeBytes]),
  );
  const decoded = new Map<string, string>();
  const relationshipCache = new Map<
    string,
    ReadonlyMap<string, Relationship>
  >();
  let decodedBytes = 0;

  const partBytes = (path: string): Uint8Array | undefined =>
    source.read(normalisePartPath(path));

  const partSize = (path: string): number | undefined =>
    sizes.get(normalisePartPath(path));

  const part = (path: string): string | undefined => {
    const normalised = normalisePartPath(path);
    const cached = decoded.get(normalised);
    if (cached !== undefined) return cached;
    const bytes = source.read(normalised);
    if (bytes === undefined) return undefined;
    /**
     * Guard: the budget counts every part this package has decoded, because the
     * per-part ceiling alone lets a package of many just-under-ceiling parts
     * exhaust memory one legal part at a time.
     */
    decodedBytes += bytes.length;
    if (decodedBytes > limits.maxDecodedPackageBytes) {
      throw fail(
        "package_too_large",
        `Reading '${normalised}' takes this package past the ${String(limits.maxDecodedPackageBytes)} byte decoding budget.`,
      );
    }
    const { text, encoding } = decodePart(bytes);
    const named = declaredEncodingOf(text);
    /**
     * Guard: a part that names a code page this reader does not decode would
     * otherwise be read as UTF-8 and fail later as malformed, which names the
     * wrong defect. utf-8 and the two utf-16 spellings are the ones the byte
     * order mark already resolved.
     */
    if (
      named !== undefined &&
      named !== encoding &&
      named !== "utf-16" &&
      named !== "us-ascii"
    ) {
      throw fail(
        "unsupported_part_encoding",
        `'${normalised}' declares encoding '${named}', which is not read.`,
      );
    }
    decoded.set(normalised, text);
    return text;
  };

  const relationshipsFor = (
    partPath: string,
  ): ReadonlyMap<string, Relationship> => {
    const owner = normalisePartPath(partPath);
    const cached = relationshipCache.get(owner);
    if (cached !== undefined) return cached;
    const relsPath = relationshipsPathFor(owner);
    const xml = part(relsPath);
    const resolved =
      xml === undefined
        ? new Map<string, Relationship>()
        : readRelationships(xml, owner, readXmlPart);
    relationshipCache.set(owner, resolved);
    return resolved;
  };

  const typesXml = part(contentTypesPath);
  if (typesXml === undefined) {
    throw fail(
      "not_a_package",
      `The archive carries no ${contentTypesPath}, so it is not an OOXML package.`,
    );
  }
  const contentTypes = readContentTypes(typesXml, readXmlPart);

  /**
   * Guard: the package-level relationships belong to the root, not to the
   * `_rels` folder that holds them, so their owner is the empty path. Naming
   * `_rels/.rels` as the owner resolves every relative target one folder too
   * deep and the main part is never found.
   */
  const packageRelationships = relationshipsFor("");

  return {
    part,
    partBytes,
    partSize,
    parts: source.entries,
    relationshipsFor,
    packageRelationships,
    contentTypes,
  };
}
