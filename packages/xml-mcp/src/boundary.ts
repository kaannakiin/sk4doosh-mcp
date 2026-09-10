import { clark, type ExpandedName } from "./node-model.js";
import { asciiLower } from "./text.js";
import type { ItemSelector } from "./query-model.js";

export interface NamespaceDeclaration {
  readonly prefix: string;
  readonly uri: string;
  readonly source: string;
}

export interface InheritedContext {
  readonly namespaces: readonly NamespaceDeclaration[];
  readonly lang?: string;
  readonly base?: string;
  readonly space?: string;
}

export type ScanRefusal =
  | { readonly reason: "not_record_shaped" }
  | {
      readonly reason: "record_too_large";
      readonly occurrence: number;
      readonly bytes: number;
    }
  | { readonly reason: "utf16" }
  | { readonly reason: "unsupported_encoding"; readonly declared: string }
  | { readonly reason: "malformed"; readonly offset: number };

export interface BoundaryScan {
  readonly context: InheritedContext;
  readonly offsets: Float64Array;
  readonly firstOrdinal: number;
  readonly scanned: number;
  readonly complete: boolean;
  readonly resumedFromHint: boolean;
}

export interface ScanResume {
  readonly byte: number;
  readonly ordinal: number;
}

export interface ScanOptions {
  readonly maxRecordBytes: number;
  readonly maxSpans: number;
  readonly from?: ScanResume;
}

export interface ShapeCandidate {
  readonly name: ExpandedName;
  readonly count: number;
}

export interface SurveyedRoot {
  readonly localName: string;
  readonly namespaceUri: string;
  readonly prefixedName: string;
}

export interface ShapeSurvey {
  readonly root: SurveyedRoot | undefined;
  readonly namespaces: readonly NamespaceDeclaration[];
  readonly candidates: readonly ShapeCandidate[];
  readonly elementCount: number;
  readonly maxDepth: number;
  readonly complete: boolean;
}

export function isRefusal(
  outcome: BoundaryScan | ShapeSurvey | ScanRefusal,
): outcome is ScanRefusal {
  return "reason" in outcome;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

const TAB = 0x09;
const NEWLINE = 0x0a;
const RETURN = 0x0d;
const SPACE = 0x20;
const BANG = 0x21;
const QUOTE = 0x22;
const APOSTROPHE = 0x27;
const SLASH = 0x2f;
const LESS = 0x3c;
const EQUALS = 0x3d;
const GREATER = 0x3e;
const QUESTION = 0x3f;

function isSpace(byte: number | undefined): boolean {
  return byte === SPACE || byte === TAB || byte === NEWLINE || byte === RETURN;
}

function matches(bytes: Uint8Array, at: number, ascii: string): boolean {
  if (at + ascii.length > bytes.length) return false;
  for (let i = 0; i < ascii.length; i += 1) {
    if (bytes[at + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

function indexOfAscii(bytes: Uint8Array, from: number, ascii: string): number {
  for (let i = from; i + ascii.length <= bytes.length; i += 1) {
    if (matches(bytes, i, ascii)) return i;
  }
  return -1;
}

function text(bytes: Uint8Array, from: number, to: number): string {
  return decoder.decode(bytes.subarray(from, to));
}

const predefined: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

function unescape(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/gu,
    (whole: string, hex?: string, dec?: string, name?: string) => {
      if (hex !== undefined)
        return String.fromCodePoint(Number.parseInt(hex, 16));
      if (dec !== undefined)
        return String.fromCodePoint(Number.parseInt(dec, 10));
      return name === undefined ? whole : (predefined[name] ?? whole);
    },
  );
}

interface Attribute {
  readonly name: string;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

interface TagScan {
  readonly qname: string;
  readonly attributes: readonly Attribute[];
  readonly end: number;
  readonly selfClosing: boolean;
}

function readName(bytes: Uint8Array, at: number): number {
  let i = at;
  while (i < bytes.length) {
    const byte = bytes[i] as number;
    if (isSpace(byte) || byte === GREATER || byte === SLASH || byte === EQUALS)
      break;
    i += 1;
  }
  return i;
}

function readStartTag(bytes: Uint8Array, at: number): TagScan | undefined {
  let i = at + 1;
  const nameEnd = readName(bytes, i);
  if (nameEnd === i) return undefined;
  const qname = text(bytes, i, nameEnd);
  const attributes: Attribute[] = [];
  i = nameEnd;
  for (;;) {
    while (isSpace(bytes[i])) i += 1;
    if (i >= bytes.length) return undefined;
    const byte = bytes[i] as number;
    if (byte === GREATER)
      return { qname, attributes, end: i + 1, selfClosing: false };
    if (byte === SLASH) {
      if (bytes[i + 1] !== GREATER) return undefined;
      return { qname, attributes, end: i + 2, selfClosing: true };
    }
    const start = i;
    const attributeNameEnd = readName(bytes, i);
    if (attributeNameEnd === i) return undefined;
    const name = text(bytes, i, attributeNameEnd);
    i = attributeNameEnd;
    while (isSpace(bytes[i])) i += 1;
    if (bytes[i] !== EQUALS) return undefined;
    i += 1;
    while (isSpace(bytes[i])) i += 1;
    const quote = bytes[i];
    if (quote !== QUOTE && quote !== APOSTROPHE) return undefined;
    i += 1;
    const valueStart = i;
    while (i < bytes.length && bytes[i] !== quote) i += 1;
    if (i >= bytes.length) return undefined;
    attributes.push({
      name,
      value: text(bytes, valueStart, i),
      start,
      end: i + 1,
    });
    i += 1;
  }
}

interface Frame {
  readonly prefix: string;
  readonly local: string;
  readonly namespaceUri: string;
  readonly declarations: readonly NamespaceDeclaration[];
  readonly lang: string | undefined;
  readonly base: string | undefined;
  readonly space: string | undefined;
  readonly start: number;
  readonly occurrence: number;
  readonly counts: Map<string, number>;
}

function splitQName(qname: string): { prefix: string; local: string } {
  const colon = qname.indexOf(":");
  if (colon < 0) return { prefix: "", local: qname };
  return { prefix: qname.slice(0, colon), local: qname.slice(colon + 1) };
}

function resolvePrefix(
  stack: readonly Frame[],
  own: readonly NamespaceDeclaration[],
  prefix: string,
): string {
  for (const declaration of own) {
    if (declaration.prefix === prefix) return declaration.uri;
  }
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    for (const declaration of (stack[i] as Frame).declarations) {
      if (declaration.prefix === prefix) return declaration.uri;
    }
  }
  return "";
}

function frameFor(
  bytes: Uint8Array,
  stack: readonly Frame[],
  tag: TagScan,
  start: number,
): Frame {
  const declarations: NamespaceDeclaration[] = [];
  let lang: string | undefined;
  let base: string | undefined;
  let space: string | undefined;
  for (const attribute of tag.attributes) {
    const source = text(bytes, attribute.start, attribute.end);
    if (attribute.name === "xmlns")
      declarations.push({ prefix: "", uri: unescape(attribute.value), source });
    else if (attribute.name.startsWith("xmlns:"))
      declarations.push({
        prefix: attribute.name.slice(6),
        uri: unescape(attribute.value),
        source,
      });
    else if (attribute.name === "xml:lang") lang = source;
    else if (attribute.name === "xml:base") base = source;
    else if (attribute.name === "xml:space") space = source;
  }
  const { prefix, local } = splitQName(tag.qname);
  const namespaceUri = resolvePrefix(stack, declarations, prefix);
  const parent = stack[stack.length - 1];
  const key = clark({ namespaceUri, localName: local });
  const occurrence = (parent?.counts.get(key) ?? 0) + 1;
  parent?.counts.set(key, occurrence);
  return {
    prefix,
    local,
    namespaceUri,
    declarations,
    lang,
    base,
    space,
    start,
    occurrence,
    counts: new Map(),
  };
}

const asciiEncodings = new Set(["utf-8", "utf8", "us-ascii", "ascii"]);

/**
 * Refuses UTF-16 and any declared encoding other than UTF-8 or US-ASCII.
 * Both would be cut wrongly and silently: UTF-16 because a markup character is
 * not one byte, a foreign declared encoding because the synthetic fragment
 * drops the XML declaration and the bytes would then be decoded as UTF-8.
 */
export function refuseEncoding(bytes: Uint8Array): ScanRefusal | undefined {
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff)
  )
    return { reason: "utf16" };
  if (bytes.length >= 4) {
    if (
      (bytes[0] === 0 && bytes[2] === 0) ||
      (bytes[1] === 0 && bytes[3] === 0)
    )
      return { reason: "utf16" };
  }
  const head = text(bytes, 0, Math.min(bytes.length, 256));
  const declaration = /^\uFEFF?\s*<\?xml\s[^?]*\?>/u.exec(head);
  if (declaration === null) return undefined;
  const encoding = /encoding\s*=\s*(?:"([^"]*)"|'([^']*)')/u.exec(
    declaration[0],
  );
  const declared = encoding?.[1] ?? encoding?.[2];
  if (declared === undefined || asciiEncodings.has(asciiLower(declared)))
    return undefined;
  return { reason: "unsupported_encoding", declared };
}

export function declaredEncodingOf(bytes: Uint8Array): string | null {
  const head = text(bytes, 0, Math.min(bytes.length, 256));
  const declaration = /^\uFEFF?\s*<\?xml\s[^?]*\?>/u.exec(head);
  if (declaration === null) return null;
  const encoding = /encoding\s*=\s*(?:"([^"]*)"|'([^']*)')/u.exec(
    declaration[0],
  );
  return encoding?.[1] ?? encoding?.[2] ?? null;
}

interface Visitor {
  readonly onStart?: (stack: readonly Frame[], frame: Frame) => void;
  readonly jump?: (stack: readonly Frame[], frame: Frame) => number | undefined;
  readonly onEnd?: (stack: readonly Frame[], frame: Frame, end: number) => void;
  readonly done?: () => boolean;
}

function walkElements(
  bytes: Uint8Array,
  visit: Visitor,
): ScanRefusal | { readonly complete: boolean } {
  const stack: Frame[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (visit.done?.() === true) return { complete: false };
    if (bytes[i] !== LESS) {
      i += 1;
      continue;
    }
    if (matches(bytes, i, "<!--")) {
      const close = indexOfAscii(bytes, i + 4, "-->");
      if (close < 0) return { reason: "malformed", offset: i };
      i = close + 3;
      continue;
    }
    if (matches(bytes, i, "<![CDATA[")) {
      const close = indexOfAscii(bytes, i + 9, "]]>");
      if (close < 0) return { reason: "malformed", offset: i };
      i = close + 3;
      continue;
    }
    if (bytes[i + 1] === QUESTION) {
      const close = indexOfAscii(bytes, i + 2, "?>");
      if (close < 0) return { reason: "malformed", offset: i };
      i = close + 2;
      continue;
    }
    if (bytes[i + 1] === BANG) return { reason: "malformed", offset: i };
    if (bytes[i + 1] === SLASH) {
      let close = readName(bytes, i + 2);
      while (close < bytes.length && bytes[close] !== GREATER) close += 1;
      if (close >= bytes.length) return { reason: "malformed", offset: i };
      const frame = stack.pop();
      if (frame === undefined) return { reason: "malformed", offset: i };
      visit.onEnd?.(stack, frame, close + 1);
      i = close + 1;
      continue;
    }
    const tag = readStartTag(bytes, i);
    if (tag === undefined) return { reason: "malformed", offset: i };
    const frame = frameFor(bytes, stack, tag, i);
    visit.onStart?.(stack, frame);
    if (tag.selfClosing) visit.onEnd?.(stack, frame, tag.end);
    else stack.push(frame);
    i = tag.end;
    const target = visit.jump?.(stack, frame);
    if (target !== undefined && target > i) i = target;
  }
  if (stack.length > 0) return { reason: "malformed", offset: bytes.length };
  return { complete: true };
}

function matchesStep(
  frame: Frame,
  step: ExpandedName & { occurrence?: number },
): boolean {
  if (frame.namespaceUri !== step.namespaceUri) return false;
  if (frame.local !== step.localName) return false;
  return step.occurrence === undefined || frame.occurrence === step.occurrence;
}

function onAncestorPath(
  stack: readonly Frame[],
  frame: Frame,
  ancestors: ItemSelector["ancestors"],
): boolean {
  if (stack.length >= ancestors.length) return false;
  const step = ancestors[stack.length];
  return step !== undefined && matchesStep(frame, step);
}

function contextOf(stack: readonly Frame[], parent: Frame): InheritedContext {
  const seen = new Map<string, NamespaceDeclaration>();
  let lang: string | undefined;
  let base: string | undefined;
  let space: string | undefined;
  for (const frame of [...stack, parent]) {
    for (const declaration of frame.declarations)
      seen.set(declaration.prefix, declaration);
    if (frame.lang !== undefined) lang = frame.lang;
    if (frame.base !== undefined) base = frame.base;
    if (frame.space !== undefined) space = frame.space;
  }
  return {
    namespaces: [...seen.values()],
    ...(lang === undefined ? {} : { lang }),
    ...(base === undefined ? {} : { base }),
    ...(space === undefined ? {} : { space }),
  };
}

function usableHint(
  bytes: Uint8Array,
  selector: ItemSelector,
  from: ScanResume | undefined,
): ScanResume | undefined {
  if (from === undefined) return undefined;
  if (
    !Number.isSafeInteger(from.byte) ||
    from.byte < 0 ||
    from.byte >= bytes.length ||
    !Number.isSafeInteger(from.ordinal) ||
    from.ordinal < 1
  )
    return undefined;
  if (bytes[from.byte] !== LESS) return undefined;
  const tag = readStartTag(bytes, from.byte);
  if (tag === undefined) return undefined;
  return splitQName(tag.qname).local === selector.name.localName
    ? from
    : undefined;
}

/**
 * Returns the byte span of every record matching `selector`, or a refusal.
 * Produces positions only, never values.
 *
 * @param options.from Advisory resume point; ignored unless the resulting scan
 * starts at the hinted byte, in which case the scan restarts from zero.
 */
export function scanRecordBoundaries(
  bytes: Uint8Array,
  selector: ItemSelector,
  options: ScanOptions,
): BoundaryScan | ScanRefusal {
  const refusal = refuseEncoding(bytes);
  if (refusal !== undefined) return refusal;

  const hinted = usableHint(bytes, selector, options.from);
  if (hinted !== undefined) {
    const attempt = runScan(bytes, selector, options, hinted);
    if (
      !("reason" in attempt) &&
      attempt.resumedFromHint &&
      attempt.offsets[0] === hinted.byte
    )
      return attempt;
  }
  return runScan(bytes, selector, options, undefined);
}

function runScan(
  bytes: Uint8Array,
  selector: ItemSelector,
  options: ScanOptions,
  hint: ScanResume | undefined,
): BoundaryScan | ScanRefusal {
  const depth = selector.ancestors.length;
  const offsets: number[] = [];
  let context: InheritedContext = { namespaces: [] };
  let ancestorsMatched = 0;
  let open: Frame | undefined;
  let oversized: ScanRefusal | undefined;
  let scanned = 0;
  let jumped = false;

  const outcome = walkElements(bytes, {
    onStart(stack, frame) {
      if (onAncestorPath(stack, frame, selector.ancestors)) {
        ancestorsMatched = stack.length + 1;
        if (ancestorsMatched === depth) context = contextOf(stack, frame);
        return;
      }
      if (stack.length !== depth || ancestorsMatched !== depth) return;
      scanned += 1;
      if (open === undefined && matchesStep(frame, selector.name)) open = frame;
    },
    jump(stack) {
      if (
        hint === undefined ||
        jumped ||
        stack.length !== depth ||
        ancestorsMatched !== depth
      )
        return undefined;
      jumped = true;
      return hint.byte;
    },
    onEnd(stack, frame, end) {
      if (stack.length < ancestorsMatched) ancestorsMatched = stack.length;
      if (frame !== open) return;
      open = undefined;
      const size = end - frame.start;
      if (size > options.maxRecordBytes) {
        oversized = {
          reason: "record_too_large",
          occurrence: offsets.length / 2 + 1,
          bytes: size,
        };
        return;
      }
      offsets.push(frame.start, end);
    },
    done: () =>
      oversized !== undefined || offsets.length >= options.maxSpans * 2,
  });

  if (oversized !== undefined) return oversized;
  if ("reason" in outcome) return outcome;
  if (offsets.length === 0) return { reason: "not_record_shaped" };
  return {
    context,
    offsets: Float64Array.from(offsets),
    firstOrdinal: jumped && hint !== undefined ? hint.ordinal : 1,
    scanned,
    complete: outcome.complete,
    resumedFromHint: jumped,
  };
}

/** Counts the distinct child element names of the document element. */
export function surveyShape(
  bytes: Uint8Array,
  options: { readonly maxCandidates: number },
): ShapeSurvey | ScanRefusal {
  const refusal = refuseEncoding(bytes);
  if (refusal !== undefined) return refusal;

  const counts = new Map<string, { name: ExpandedName; count: number }>();
  const namespaces = new Map<string, NamespaceDeclaration>();
  let root: SurveyedRoot | undefined;
  let elementCount = 0;
  let maxDepth = 0;

  const outcome = walkElements(bytes, {
    onStart(stack, frame) {
      elementCount += 1;
      maxDepth = Math.max(maxDepth, stack.length + 1);
      for (const declaration of frame.declarations) {
        if (!namespaces.has(declaration.uri))
          namespaces.set(declaration.uri, declaration);
      }
      if (stack.length === 0) {
        root = {
          localName: frame.local,
          namespaceUri: frame.namespaceUri,
          prefixedName:
            frame.prefix === ""
              ? frame.local
              : `${frame.prefix}:${frame.local}`,
        };
        return;
      }
      if (stack.length !== 1) return;
      const name = {
        namespaceUri: frame.namespaceUri,
        localName: frame.local,
      };
      const key = clark(name);
      const entry = counts.get(key);
      if (entry === undefined) counts.set(key, { name, count: 1 });
      else entry.count += 1;
    },
  });

  if ("reason" in outcome) return outcome;
  const candidates = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, options.maxCandidates);
  return {
    root,
    namespaces: [...namespaces.values()],
    candidates,
    elementCount,
    maxDepth,
    complete: outcome.complete,
  };
}
