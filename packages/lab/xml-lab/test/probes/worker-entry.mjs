import { parentPort, workerData } from "node:worker_threads";
import { Buffer } from "node:buffer";
import { XmlDocument, ParseOption, diag } from "libxml2-wasm";

const HARDENED =
  ParseOption.XML_PARSE_NO_XXE |
  ParseOption.XML_PARSE_NONET |
  ParseOption.XML_PARSE_NO_SYS_CATALOG;

const beacon =
  workerData?.beacon === undefined ? null : new Int32Array(workerData.beacon);

if (workerData?.diag === true) diag.configure({ enabled: true });

const documents = new Map();
const capacity = workerData?.capacity ?? 4;

const evict = () => {
  while (documents.size > capacity) {
    const oldest = documents.keys().next().value;
    documents.get(oldest).dispose();
    documents.delete(oldest);
  }
};

const load = (docId, base64) => {
  const existing = documents.get(docId);
  if (existing !== undefined) {
    documents.delete(docId);
    documents.set(docId, existing);
    return existing;
  }
  const document = XmlDocument.fromBuffer(Buffer.from(base64, "base64"), {
    option: HARDENED,
  });
  documents.set(docId, document);
  evict();
  return document;
};

parentPort.on("message", (message) => {
  try {
    if (message.kind === "parse") {
      const document = load(message.docId, message.base64);
      parentPort.postMessage({
        id: message.id,
        ok: true,
        result: { root: document.root.name, live: documents.size },
      });
      return;
    }
    if (message.kind === "query") {
      const document = load(message.docId, message.base64);
      const value = document.eval(message.expression);
      parentPort.postMessage({
        id: message.id,
        ok: true,
        result: {
          resultType: Array.isArray(value) ? "nodeset" : typeof value,
          count: Array.isArray(value) ? value.length : null,
          value: Array.isArray(value) ? null : value,
        },
      });
      return;
    }
    if (message.kind === "loop") {
      for (let index = 0; index < message.iterations; index += 1) {
        const document = XmlDocument.fromBuffer(
          Buffer.from(message.base64, "base64"),
          { option: HARDENED },
        );
        document.eval("count(//i)");
        document.dispose();
        if (beacon !== null) Atomics.add(beacon, 0, 1);
      }
      parentPort.postMessage({
        id: message.id,
        ok: true,
        result: { done: true },
      });
      return;
    }
    if (message.kind === "diag") {
      const report = diag.report();
      parentPort.postMessage({
        id: message.id,
        ok: true,
        result: {
          live: Object.fromEntries(
            Object.entries(report).map(([name, value]) => [
              name,
              value.totalInstances,
            ]),
          ),
          garbageCollected: Object.fromEntries(
            Object.entries(report).map(([name, value]) => [
              name,
              value.garbageCollected,
            ]),
          ),
          cached: documents.size,
        },
      });
      return;
    }
    if (message.kind === "release") {
      for (const document of documents.values()) document.dispose();
      documents.clear();
      parentPort.postMessage({ id: message.id, ok: true, result: {} });
      return;
    }
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: `unknown kind ${message.kind}`,
    });
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: error.constructor.name,
      message: String(error.message).slice(0, 200),
    });
  }
});

parentPort.postMessage({ ready: true });
