import { extname } from "node:path";
import type { CoreErrorCode, ErrorFactory } from "./errors.js";
import { asciiLower } from "./unicode.js";
import type { Vocabulary } from "./vocabulary.js";

export type SourceExtension = `.${string}`;

export interface FormatRegistry<Format extends string = string> {
  readonly extensions: ReadonlyMap<SourceExtension, Format>;
  readonly names: readonly Format[];
  has(extension: string): boolean;
  formatFor(path: string): Format;
}

export function extensionListOf(registry: FormatRegistry): string {
  return [...registry.extensions.keys()].join(", ");
}

export function createFormatRegistry<Format extends string>(
  extensions: Readonly<Record<SourceExtension, Format>>,
  vocabulary: Vocabulary<string>,
  fail: ErrorFactory<CoreErrorCode>,
): FormatRegistry<Format> {
  const map = new Map(
    Object.entries(extensions) as [SourceExtension, Format][],
  );
  const registry: FormatRegistry<Format> = {
    extensions: map,
    names: [...new Set(map.values())],
    has(extension) {
      return map.has(extension as SourceExtension);
    },
    formatFor(path) {
      const format = map.get(asciiLower(extname(path)) as SourceExtension);
      if (format === undefined) {
        throw fail(
          "unsupported_extension",
          `'${path}' is not a ${vocabulary.readableLabel}.`,
          `Readable extensions: ${extensionListOf(registry)}.`,
        );
      }
      return format;
    },
  };
  return registry;
}
