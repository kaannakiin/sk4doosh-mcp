import {
  createDocumentStore,
  type DocumentStore,
  type OpenedFile,
  type ParseContext,
  type SandboxedPath,
} from "@sk-mcp/file-core";
import { scanProlog } from "./doctype.js";
import { SkMcpXmlError, fail } from "./errors.js";
import { limits } from "./limits.js";
import { vocabulary } from "./vocabulary.js";
import type { XmlWorkerPool } from "./worker-pool.js";
import type { RootFacts } from "./worker-protocol.js";

export interface XmlDocumentBody {
  readonly format: "xml";
  readonly residency: string;
  readonly generation: number;
  readonly declaredEncoding: string | null;
  readonly warningCount: number;
  readonly root: RootFacts;
}

export type LoadedXmlDocument = XmlDocumentBody & OpenedFile;

export interface XmlDocumentCache {
  load(path: SandboxedPath): Promise<LoadedXmlDocument>;
  clear(): void;
  readonly size: number;
}

const doctypeRefusal =
  "The document declares a DOCTYPE. Document type declarations are refused so no external entity, DTD or XInclude is ever resolved.";

function translate(failure: string, detail: string | undefined): never {
  if (failure === "doctype_not_allowed") {
    throw new SkMcpXmlError(
      "doctype_not_allowed",
      doctypeRefusal,
      "Remove the DOCTYPE declaration, or read a document that does not use one.",
    );
  }
  if (failure === "resource_limit") {
    throw new SkMcpXmlError(
      "resource_limit",
      detail === "timeout"
        ? `Parsing exceeded the ${limits.maxParseMs} millisecond budget.`
        : "The XML parse service refused the request.",
      "Retry with a smaller document.",
    );
  }
  throw new SkMcpXmlError(
    "malformed_xml",
    "The document is not well-formed XML.",
    "Fix the markup and read the file again.",
  );
}

export function createXmlDocumentCache(
  pool: XmlWorkerPool,
  root?: string,
): XmlDocumentCache {
  async function parse(context: ParseContext): Promise<XmlDocumentBody> {
    const prolog = scanProlog(context.bytes, limits.prologScanBytes);
    if (prolog.doctype) {
      throw new SkMcpXmlError(
        "doctype_not_allowed",
        doctypeRefusal,
        "Remove the DOCTYPE declaration, or read a document that does not use one.",
      );
    }
    const logical = context.path as string;
    const outcome = await pool.parse(
      context.stamp,
      logical,
      Uint8Array.from(context.bytes),
    );
    if (!outcome.ok) {
      translate(outcome.failure, outcome.detail);
    }
    return {
      format: "xml",
      residency: `${pool.generation}:${context.stamp}`,
      generation: pool.generation,
      declaredEncoding: outcome.value.declaredEncoding,
      warningCount: outcome.value.warningCount,
      root: outcome.value.root,
    };
  }

  const store: DocumentStore<
    XmlDocumentBody,
    Record<string, never>
  > = createDocumentStore({
    maxEntries: limits.documentCacheSize,
    maxBytes: limits.maxXmlBytes,
    ...(root === undefined ? {} : { root }),
    vocabulary,
    fail,
    variantKey: () => "",
    parse,
  });

  pool.onGenerationChange(() => {
    store.clear();
  });

  return {
    async load(path) {
      const first = await store.load(path, {});
      if (first.generation === pool.generation) {
        return first;
      }
      store.clear();
      const second = await store.load(path, {});
      if (second.generation !== pool.generation) {
        throw new SkMcpXmlError(
          "internal_error",
          "The parse worker restarted twice while reading one document.",
          "Retry the call.",
        );
      }
      return second;
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    },
  };
}
