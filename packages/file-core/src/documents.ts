import { relative } from "node:path";
import { accessError, assertSnapshot, knownRoot, pinRoot } from "./access.js";
import { contentFingerprint, type Fingerprint } from "./cursor.js";
import { type CoreErrorCode, type ErrorFactory } from "./errors.js";
import type { SandboxedPath } from "./paths.js";
import type { Vocabulary } from "./vocabulary.js";

const variantSeparator = "\u0000";

export interface OpenedFile {
  readonly stamp: Fingerprint;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
}

export interface ParseContext extends OpenedFile {
  readonly bytes: Buffer;
  readonly path: SandboxedPath;
  readonly displayPath: string;
}

export interface DocumentStoreSpec<Loaded, Options> {
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly maxBytesFor?: (path: SandboxedPath, options: Options) => number;
  readonly root?: string;
  readonly vocabulary: Vocabulary<string>;
  readonly fail: ErrorFactory<CoreErrorCode>;
  readonly variantKey: (options: Options) => string;
  readonly parse: (context: ParseContext, options: Options) => Promise<Loaded>;
}

export interface DocumentStore<Loaded, Options> {
  load(path: SandboxedPath, options: Options): Promise<Loaded & OpenedFile>;
  clear(): void;
  readonly size: number;
}

export function createDocumentStore<Loaded, Options>(
  spec: DocumentStoreSpec<Loaded, Options>,
): DocumentStore<Loaded, Options> {
  const cache = new Map<string, Loaded & OpenedFile>();
  const configured =
    spec.root === undefined
      ? undefined
      : { real: spec.root, access: pinRoot(spec.root) };

  function remember(
    key: string,
    document: Loaded & OpenedFile,
  ): Loaded & OpenedFile {
    cache.delete(key);
    cache.set(key, document);
    while (cache.size > spec.maxEntries) {
      const oldest = cache.keys().next();
      if (oldest.done === true) {
        break;
      }
      cache.delete(oldest.value);
    }
    return document;
  }

  return {
    get size() {
      return cache.size;
    },
    clear() {
      cache.clear();
    },
    async load(path, options) {
      const key = [path, spec.variantKey(options)].join(variantSeparator);
      const root = configured ?? knownRoot(path);
      if (root === undefined)
        throw spec.fail(
          "invalid_argument",
          "A pinned sandbox root is required to load a document.",
        );
      const displayPath = relative(root.real, path);
      const maxBytes = Math.min(
        spec.maxBytes,
        spec.maxBytesFor?.(path, options) ?? spec.maxBytes,
      );
      let snapshot;
      try {
        snapshot = await root.access.read(displayPath, maxBytes);
        assertSnapshot(snapshot, maxBytes);
      } catch (error) {
        const mapped = accessError(error, spec.fail);
        if (mapped.code === "file_too_large")
          throw spec.fail(
            "file_too_large",
            mapped.message,
            spec.vocabulary.tooLargeRecovery,
          );
        throw mapped;
      }
      const stamp = contentFingerprint(
        path,
        snapshot.bytes,
        spec.variantKey(options),
      );
      const cached = cache.get(key);
      const modifiedAt = new Date(snapshot.modifiedMs).toISOString();
      if (
        cached !== undefined &&
        cached.stamp === stamp &&
        cached.modifiedAt === modifiedAt
      ) {
        return remember(key, cached);
      }
      const opened: OpenedFile = {
        stamp,
        sizeBytes: snapshot.size,
        modifiedAt,
      };
      const parsed = await spec.parse(
        { ...opened, bytes: snapshot.bytes, path, displayPath },
        options,
      );
      return remember(key, { ...parsed, ...opened });
    },
  };
}
