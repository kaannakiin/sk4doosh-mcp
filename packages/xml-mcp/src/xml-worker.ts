import { parentPort, workerData } from "node:worker_threads";
import { diag, ParseOption, XmlDocument } from "libxml2-wasm";
import {
  projectDiag,
  type ParsedFacts,
  type WorkerReply,
  type WorkerRequest,
} from "./worker-protocol.js";

const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

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
  const root = document.root;
  return {
    declaredEncoding: document.encoding ?? null,
    warningCount: document.warnings.length,
    root: {
      localName: root.name,
      namespaceUri: root.namespaceUri ?? "",
      prefixedName: root.name,
    },
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

port.on("message", (request: WorkerRequest) => {
  let reply: WorkerReply;
  try {
    if (request.kind === "parse") {
      reply = { id: request.id, ok: true, facts: adopt(request) };
    } else if (request.kind === "diag") {
      reply = {
        id: request.id,
        ok: true,
        diag: projectDiag(diag.report(), documents.size),
      };
    } else {
      releaseAll();
      reply = { id: request.id, ok: true };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reply = {
      id: request.id,
      ok: false,
      failure:
        detail === "doctype_not_allowed"
          ? "doctype_not_allowed"
          : "malformed_xml",
      detail: detail.slice(0, 200),
    };
  }
  port.postMessage(reply);
});

port.postMessage({ id: 0, ok: true });
