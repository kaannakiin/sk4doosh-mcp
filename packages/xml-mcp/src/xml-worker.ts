import { parentPort, workerData } from "node:worker_threads";
import { diag, XmlDocument } from "libxml2-wasm";
import { aggregateDocument } from "./aggregate.js";
import { describeDocument, rootFactsOf } from "./describe.js";
import { scan } from "./find.js";
import { NumericPrecisionError } from "./numeric.js";
import { HARDENED } from "./parse-policy.js";
import { projectRecords } from "./records.js";
import { resolveAddress, resolveScopePath, walk } from "./traverse.js";
import {
  projectDiag,
  type ParsedFacts,
  type WorkerFailure,
  type WorkerReply,
  type WorkerRequest,
} from "./worker-protocol.js";
import { evaluate } from "./xpath.js";

const port = parentPort;
if (port === null) {
  throw new Error("The XML worker requires a parent port.");
}

const options = workerData as {
  readonly capacity: number;
  readonly diagnostics: boolean;
};
if (options.diagnostics) {
  diag.configure({ enabled: true });
}

const documents = new Map<string, XmlDocument>();
const byLogical = new Map<string, string>();

function forget(stamp: string): void {
  const held = documents.get(stamp);
  if (held === undefined) {
    return;
  }
  held.dispose();
  documents.delete(stamp);
}

function supersede(logical: string, stamp: string): void {
  const previous = byLogical.get(logical);
  if (previous !== undefined && previous !== stamp) {
    forget(previous);
  }
  byLogical.set(logical, stamp);
}

function evict(): void {
  while (documents.size > options.capacity) {
    const oldest = documents.keys().next();
    if (oldest.done === true) {
      return;
    }
    for (const [logical, stamp] of byLogical) {
      if (stamp === oldest.value) {
        byLogical.delete(logical);
      }
    }
    forget(oldest.value);
  }
}

function factsOf(document: XmlDocument): ParsedFacts {
  return {
    declaredEncoding: document.encoding ?? null,
    warningCount: document.warnings.length,
    root: rootFactsOf(document),
  };
}

function touch(stamp: string): XmlDocument | undefined {
  const held = documents.get(stamp);
  if (held === undefined) {
    return undefined;
  }
  documents.delete(stamp);
  documents.set(stamp, held);
  return held;
}

function adopt(request: {
  readonly stamp: string;
  readonly logical: string;
  readonly bytes: Uint8Array;
}): ParsedFacts {
  const existing = touch(request.stamp);
  if (existing !== undefined) {
    return factsOf(existing);
  }
  let adopted = false;
  const document = XmlDocument.fromBuffer(Buffer.from(request.bytes), {
    option: HARDENED,
  });
  try {
    if (document.dtd !== null) {
      throw new Error("doctype_not_allowed");
    }
    const facts = factsOf(document);
    supersede(request.logical, request.stamp);
    documents.set(request.stamp, document);
    adopted = true;
    evict();
    return facts;
  } finally {
    if (!adopted) {
      document.dispose();
    }
  }
}

function releaseAll(): void {
  for (const document of documents.values()) {
    document.dispose();
  }
  documents.clear();
  byLogical.clear();
}

function missing(kind: WorkerRequest["kind"], id: number): WorkerReply {
  return { kind, id, ok: false, failure: "unknown_residency" };
}

function unaddressed(kind: WorkerRequest["kind"], id: number): WorkerReply {
  return { kind, id, ok: false, failure: "address_not_found" };
}

function handle(request: WorkerRequest): WorkerReply {
  switch (request.kind) {
    case "parse":
      return { kind: "parse", id: request.id, ok: true, value: adopt(request) };
    case "describe": {
      const document = touch(request.stamp);
      if (document === undefined) return missing(request.kind, request.id);
      return {
        kind: "describe",
        id: request.id,
        ok: true,
        value: describeDocument(
          document,
          request.maxVisits,
          request.maxCandidates,
        ),
      };
    }
    case "read": {
      const document = touch(request.stamp);
      if (document === undefined) return missing(request.kind, request.id);
      const scope =
        request.view.scopePath === undefined
          ? resolveAddress(document.root, request.view.address ?? [])
          : resolveScopePath(document.root, request.view.scopePath);
      if (scope === undefined) return unaddressed(request.kind, request.id);
      const page = walk(scope, request.view, request.view.resume);
      return {
        kind: "read",
        id: request.id,
        ok: true,
        value: {
          records: page.records,
          scopeAddress: scope.address,
          scopePath: scope.path,
          ...(page.context === undefined ? {} : { context: page.context }),
          ...(page.next === undefined ? {} : { next: page.next }),
        },
      };
    }
    case "find": {
      const document = touch(request.stamp);
      if (document === undefined) return missing(request.kind, request.id);
      const scope =
        request.probe.scopePath === undefined
          ? resolveAddress(document.root, request.probe.scopeAddress ?? [])
          : resolveScopePath(document.root, request.probe.scopePath);
      if (scope === undefined) return unaddressed(request.kind, request.id);
      return {
        kind: "find",
        id: request.id,
        ok: true,
        value: scan(scope, request.probe),
      };
    }
    case "xpath": {
      const document = touch(request.stamp);
      if (document === undefined) return missing(request.kind, request.id);
      return {
        kind: "xpath",
        id: request.id,
        ok: true,
        value: evaluate(document, request.probe),
      };
    }
    case "records": {
      const document = touch(request.stamp);
      if (document === undefined) return missing(request.kind, request.id);
      const page = projectRecords(document.root, request.probe);
      if (page === undefined) return unaddressed(request.kind, request.id);
      return { kind: "records", id: request.id, ok: true, value: page };
    }
    case "aggregate": {
      const document = touch(request.stamp);
      if (document === undefined) return missing(request.kind, request.id);
      const outcome = aggregateDocument(document.root, request.probe);
      if (outcome === undefined) return unaddressed(request.kind, request.id);
      return { kind: "aggregate", id: request.id, ok: true, value: outcome };
    }
    case "diag":
      return {
        kind: "diag",
        id: request.id,
        ok: true,
        value: projectDiag(diag.report(), documents.size),
      };
    case "release":
      releaseAll();
      return { kind: "release", id: request.id, ok: true, value: null };
    default: {
      const unreachable: never = request;
      return {
        kind: "boot",
        id: (unreachable as { readonly id: number }).id,
        ok: false,
        failure: "internal_error",
      };
    }
  }
}

interface Classified {
  readonly failure: WorkerFailure;
  readonly detail?: string;
}

function classify(error: unknown): Classified {
  if (error instanceof NumericPrecisionError) {
    return { failure: "numeric_precision", detail: error.text.slice(0, 80) };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message === "doctype_not_allowed") {
    return { failure: "doctype_not_allowed" };
  }
  if (message === "xpath_compile" || message === "xpath_eval") {
    const cause = error instanceof Error ? error.cause : undefined;
    const detail = cause instanceof Error ? cause.message : undefined;
    return {
      failure: message,
      ...(detail === undefined ? {} : { detail: detail.slice(0, 200) }),
    };
  }
  if (
    message === "unsupported_node_kind" ||
    message === "locate_received_attribute"
  ) {
    return { failure: "internal_error", detail: message };
  }
  return { failure: "malformed_xml", detail: message.slice(0, 200) };
}

port.on("message", (request: WorkerRequest) => {
  let reply: WorkerReply;
  try {
    reply = handle(request);
  } catch (error) {
    reply = {
      kind: request.kind,
      id: request.id,
      ok: false,
      ...classify(error),
    };
  }
  port.postMessage(reply);
});

port.postMessage({ kind: "boot", id: 0, ok: true, value: null });
