import {
  createDocumentStore,
  type DocumentStore,
  type OpenedFile,
  type ParseContext,
  type SandboxedPath,
  type SourceReader,
} from "@sk-mcp/file-core";
import {
  declaredEncodingOf,
  isRefusal,
  surveyShape,
  type ShapeSurvey,
} from "./boundary.js";
import { refusalError } from "./chunked.js";
import { scanProlog } from "./doctype.js";
import { SkMcpXmlError, fail } from "./errors.js";
import { limits } from "./limits.js";
import { vocabulary } from "./vocabulary.js";
import type { XmlWorkerPool } from "./worker-pool.js";
import type {
  RootFacts,
  WorkerBodyOf,
  WorkerKind,
  WorkerResultOf,
} from "./worker-protocol.js";

export interface ResidentXmlDocument {
  readonly format: "xml";
  readonly mode: "resident";
  readonly residency: string;
  readonly generation: number;
  readonly declaredEncoding: string | null;
  readonly warningCount: number;
  readonly root: RootFacts;
}

export interface ChunkedXmlDocument {
  readonly format: "xml";
  readonly mode: "chunked";
  readonly declaredEncoding: string | null;
  readonly warningCount: 0;
  readonly root: RootFacts;
  readonly survey: ShapeSurvey;
  readonly source: SourceReader;
  readonly bytes: Buffer;
}

export type XmlDocumentBody = ResidentXmlDocument | ChunkedXmlDocument;

export type LoadedXmlDocument = XmlDocumentBody & OpenedFile;

export type ResidentKind = Extract<
  WorkerKind,
  "describe" | "read" | "find" | "xpath" | "records" | "aggregate"
>;

export type ResidentBody = WorkerBodyOf<ResidentKind>;

export type FailureMapper = (
  failure: string,
  detail: string | undefined,
) => SkMcpXmlError | undefined;

export interface XmlDocumentCache {
  load(path: SandboxedPath): Promise<LoadedXmlDocument>;
  ask<B extends ResidentBody>(
    path: SandboxedPath,
    stamp: string,
    body: (stamp: string) => B,
    signal?: AbortSignal,
    mapFailure?: FailureMapper,
  ): Promise<WorkerResultOf<B["kind"]>>;
  clear(): void;
  readonly size: number;
}

const doctypeRefusal =
  "The document declares a DOCTYPE. Document type declarations are refused so no external entity, DTD or XInclude is ever resolved.";

function translate(
  failure: string,
  detail: string | undefined,
  mapFailure?: FailureMapper,
): never {
  const mapped = mapFailure?.(failure, detail);
  if (mapped !== undefined) throw mapped;
  if (failure === "numeric_precision") {
    throw new SkMcpXmlError(
      "numeric_precision",
      `The value ${detail ?? ""} carries more digits than a binary64 number holds, so a numeric metric would change it.`,
      "Use count, countValues or countDistinct, or project the rows and total them outside this server.",
    );
  }
  if (failure === "doctype_not_allowed") {
    throw new SkMcpXmlError(
      "doctype_not_allowed",
      doctypeRefusal,
      "Remove the DOCTYPE declaration, or read a document that does not use one.",
    );
  }
  if (failure === "address_not_found") {
    throw new SkMcpXmlError(
      "invalid_argument",
      "No node matches that address in this document.",
      "Call describe_document for a usable address, or drop address to start at the document element.",
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

function surveyChunked(
  context: ParseContext,
  bytes: Buffer,
): ChunkedXmlDocument {
  const survey = surveyShape(bytes, {
    maxCandidates: limits.maxDescribePaths,
  });
  if (isRefusal(survey)) throw refusalError(survey);
  if (survey.root === undefined)
    throw new SkMcpXmlError(
      "malformed_xml",
      "The document is not well-formed XML.",
      "Fix the markup and read the file again.",
    );
  return {
    format: "xml",
    mode: "chunked",
    declaredEncoding: declaredEncodingOf(bytes),
    warningCount: 0,
    root: {
      localName: survey.root.localName,
      namespaceUri: survey.root.namespaceUri,
      prefixedName: survey.root.prefixedName,
    },
    survey,
    source: context.source,
    bytes,
  };
}

export function createXmlDocumentCache(
  pool: XmlWorkerPool,
  root?: string,
  maxEntries: number = limits.documentCacheSize,
  residentMaxBytes: number = limits.residentMaxBytes,
): XmlDocumentCache {
  async function parse(context: ParseContext): Promise<XmlDocumentBody> {
    const bytes =
      context.mode === "resident"
        ? context.bytes
        : await context.source.read({
            offset: 0,
            length: context.source.sizeBytes,
          });
    const prolog = scanProlog(bytes, limits.prologScanBytes);
    if (prolog.unsupportedEncoding !== undefined) {
      throw new SkMcpXmlError(
        "unsupported_encoding",
        `The document is encoded as ${prolog.unsupportedEncoding}, which this server cannot read.`,
        "Re-encode the document as UTF-8 or UTF-16.",
      );
    }
    if (prolog.doctype) {
      throw new SkMcpXmlError(
        "doctype_not_allowed",
        doctypeRefusal,
        "Remove the DOCTYPE declaration, or read a document that does not use one.",
      );
    }
    if (context.mode === "chunked") return surveyChunked(context, bytes);
    const logical = context.path as string;
    const outcome = await pool.ask({
      kind: "parse",
      stamp: context.stamp,
      logical,
      bytes: Uint8Array.from(bytes),
    });
    if (!outcome.ok) {
      translate(outcome.failure, outcome.detail);
    }
    return {
      format: "xml",
      mode: "resident",
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
    maxEntries,
    maxBytes: limits.maxXmlBytes,
    mode: { residentMaxBytes },
    ...(root === undefined ? {} : { root }),
    vocabulary,
    fail,
    variantKey: () => "",
    parse,
  });

  pool.onGenerationChange(() => {
    store.clear();
  });

  async function load(path: SandboxedPath): Promise<LoadedXmlDocument> {
    const first = await store.load(path, {});
    if (first.mode === "chunked" || first.generation === pool.generation) {
      return first;
    }
    store.clear();
    const second = await store.load(path, {});
    if (second.mode === "resident" && second.generation !== pool.generation) {
      throw new SkMcpXmlError(
        "internal_error",
        "The parse worker restarted twice while reading one document.",
        "Retry the call.",
      );
    }
    return second;
  }

  return {
    load,
    async ask(path, stamp, body, signal, mapFailure) {
      const first = await pool.ask(body(stamp), signal);
      if (first.ok) {
        return first.value;
      }
      if (first.failure !== "unknown_residency") {
        translate(first.failure, first.detail, mapFailure);
      }
      store.clear();
      const reloaded = await load(path);
      const second = await pool.ask(body(reloaded.stamp), signal);
      if (second.ok) {
        return second.value;
      }
      if (second.failure === "unknown_residency") {
        throw new SkMcpXmlError(
          "internal_error",
          "The parse worker lost the document twice while answering one call.",
          "Retry the call.",
        );
      }
      return translate(second.failure, second.detail, mapFailure);
    },
    clear() {
      store.clear();
    },
    get size() {
      return store.size;
    },
  };
}
