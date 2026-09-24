import type { DiagnosticSink } from "../diagnostics.js";
import { childPointer, rootPointer, type JsonPointer } from "../ir/brand.js";
import {
  entriesOf,
  isObject,
  type JsonObject,
  type JsonValue,
  type MutableJsonObject,
} from "../ir/json.js";
import { parseDocument } from "../parse/parse.js";
import { resolvePointer } from "./refs.js";

/**
 * Reads one referenced document. The host decides what may be read: an allowlist of hosts, a
 * deadline and a size limit for a URL, and a root directory for a file. An external reference is a
 * way for a document's author to make the ingesting process issue a request.
 */
export type DocumentLoader = (url: URL) => Promise<string>;

const maxDepth = 32;

interface Bundler {
  readonly loader: DocumentLoader;
  readonly diagnostics: DiagnosticSink;
  readonly cache: Map<string, Promise<JsonObject | undefined>>;
}

function firstExternalRef(
  value: JsonValue,
  at: JsonPointer,
): JsonPointer | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of (value as readonly JsonValue[]).entries()) {
      const found = firstExternalRef(item, childPointer(at, index));
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (!isObject(value)) {
    return undefined;
  }
  for (const [key, child] of entriesOf(value)) {
    if (key === "$ref" && typeof child === "string") {
      if (!child.startsWith("#")) {
        return childPointer(at, key);
      }
      continue;
    }
    const found = firstExternalRef(child, childPointer(at, key));
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function load(bundler: Bundler, url: URL): Promise<JsonObject | undefined> {
  const key = url.href.replace(/#.*$/, "");
  let pending = bundler.cache.get(key);
  if (pending === undefined) {
    pending = bundler
      .loader(new URL(key))
      .then((text) => parseDocument(text, bundler.diagnostics));
    bundler.cache.set(key, pending);
  }
  return pending;
}

/**
 * Inlines every external reference. The referenced fragment is inlined with its own references
 * resolved against its own document, so the result has only local references left.
 */
async function inline(
  bundler: Bundler,
  value: JsonValue,
  base: URL,
  document: JsonObject,
  at: JsonPointer,
  depth: number,
  local: boolean,
): Promise<JsonValue> {
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((item, index) =>
        inline(
          bundler,
          item,
          base,
          document,
          childPointer(at, index),
          depth,
          local,
        ),
      ),
    );
  }
  if (!isObject(value)) {
    return value;
  }
  const ref = value["$ref"];
  if (typeof ref === "string" && (!ref.startsWith("#") || !local)) {
    if (depth >= maxDepth) {
      bundler.diagnostics.report(
        "external_ref_blocked",
        at,
        `Reference '${ref}' nests more than ${String(maxDepth)} documents deep.`,
      );
      return {};
    }
    const target = new URL(ref, base);
    const targetDocument = ref.startsWith("#")
      ? document
      : await load(bundler, target);
    if (targetDocument === undefined) {
      return {};
    }
    const fragment = resolvePointer(targetDocument, target.hash);
    if (fragment === undefined) {
      bundler.diagnostics.report(
        "external_ref_blocked",
        at,
        `Reference '${ref}' resolves to nothing.`,
      );
      return {};
    }
    return inline(
      bundler,
      fragment,
      target,
      targetDocument,
      at,
      depth + 1,
      false,
    );
  }
  const out: MutableJsonObject = {};
  for (const [key, child] of entriesOf(value)) {
    out[key] = await inline(
      bundler,
      child,
      base,
      document,
      childPointer(at, key),
      depth,
      local,
    );
  }
  return out;
}

export async function bundleExternal(
  document: JsonObject,
  documentUrl: string | undefined,
  loader: DocumentLoader | undefined,
  diagnostics: DiagnosticSink,
): Promise<JsonObject | undefined> {
  const external = firstExternalRef(document, rootPointer);
  if (external === undefined) {
    return document;
  }
  if (loader === undefined || documentUrl === undefined) {
    diagnostics.report(
      "external_ref_blocked",
      external,
      "The document references another document, and no loader was configured to read it.",
    );
    return undefined;
  }
  const bundler: Bundler = { loader, diagnostics, cache: new Map() };
  const bundled = await inline(
    bundler,
    document,
    new URL(documentUrl),
    document,
    rootPointer,
    0,
    true,
  );
  return isObject(bundled) ? bundled : undefined;
}
