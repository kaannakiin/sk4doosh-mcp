import type { ContentTypes } from "../model/package.js";
import { asciiLower } from "../primitives/text.js";
import { ooxmlNamespaces } from "../xml/namespaces.js";
import type { XmlPartReader } from "../xml/read.js";
import { extensionOf, normalisePartPath } from "./names.js";

export const contentTypesPath = "[Content_Types].xml";

/**
 * Reads the package's content-type map.
 *
 * @param xml the decoded `[Content_Types].xml` part.
 * @param readXmlPart the part reader to scan it with.
 * @returns the defaults keyed by ASCII-folded extension and the overrides keyed
 * by ASCII-folded part path.
 */
export function readContentTypes(
  xml: string,
  readXmlPart: XmlPartReader,
): ContentTypes {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  readXmlPart(xml, contentTypesPath, {
    onOpen(node) {
      if (node.uri !== ooxmlNamespaces.contentTypes) return;
      const contentType = node.attr("ContentType");
      if (contentType === undefined) return;
      if (node.local === "Default") {
        const extension = node.attr("Extension");
        if (extension !== undefined) {
          defaults.set(asciiLower(extension), contentType);
        }
        return;
      }
      if (node.local === "Override") {
        const partName = node.attr("PartName");
        if (partName !== undefined) {
          overrides.set(asciiLower(normalisePartPath(partName)), contentType);
        }
      }
    },
  });

  return {
    defaults,
    overrides,
    /**
     * Guard: OPC gives an Override precedence over a Default, and compares both
     * part names and extensions without regard to ASCII case. Reversing the
     * precedence hands back the generic type for a part the package explicitly
     * typed.
     */
    contentTypeOf(partPath) {
      const normalised = asciiLower(normalisePartPath(partPath));
      return overrides.get(normalised) ?? defaults.get(extensionOf(normalised));
    },
  };
}
