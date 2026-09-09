import { XmlCData, XmlElement, XmlText } from "libxml2-wasm";
import type { FindMatch, FindPage, FindProbe } from "./find-model.js";
import {
  clark,
  formatNodeId,
  type NodeAddress,
  type NodePath,
} from "./node-model.js";
import {
  advance,
  descend,
  frameFor,
  nextUnvisited,
  stepOf,
  type Frame,
  type WalkScope,
} from "./traverse.js";

const contextChars = 32;

function matchIndex(value: string, probe: FindProbe): number {
  if (probe.matchMode === "exact") return value === probe.query ? 0 : -1;
  return value.indexOf(probe.query);
}

function snippetOf(
  value: string,
  at: number,
  maxChars: number,
): { readonly snippet: string; readonly truncated: boolean } {
  if (value.length <= maxChars) return { snippet: value, truncated: false };
  const start = Math.max(0, at - contextChars);
  return { snippet: value.slice(start, start + maxChars), truncated: true };
}

function scanAttributes(
  element: XmlElement,
  path: NodePath,
  address: NodeAddress,
  probe: FindProbe,
  matches: FindMatch[],
): void {
  for (const attribute of element.attrs) {
    if (matches.length >= probe.maxResults) return;
    const at = matchIndex(attribute.value, probe);
    if (at === -1) continue;
    const { snippet, truncated } = snippetOf(
      attribute.value,
      at,
      probe.maxChars,
    );
    matches.push({
      nodeId: formatNodeId(path),
      address,
      matchKind: "attribute",
      attribute: {
        namespaceUri: attribute.namespaceUri,
        localName: attribute.name,
      },
      snippet,
      ...(truncated ? { snippetTruncated: true as const } : {}),
    });
  }
}

export function scan(scope: WalkScope, probe: FindProbe): FindPage {
  const wantsText = probe.searchIn !== "attributes";
  const wantsAttributes = probe.searchIn !== "text";
  const matches: FindMatch[] = [];

  let stack: Frame[];
  let scannedCount = 0;
  let complete = true;

  if (probe.resume === undefined) {
    stack = [frameFor(scope.element, scope.path, scope.address, 0)];
    scannedCount = 1;
    if (wantsAttributes) {
      scanAttributes(scope.element, scope.path, scope.address, probe, matches);
    }
  } else {
    const rebuilt = descend(scope, probe.resume);
    if (rebuilt === undefined) {
      return {
        matches,
        scannedCount,
        scopeAddress: scope.address,
        scopePath: scope.path,
        complete: true,
      };
    }
    stack = rebuilt;
  }

  while (stack.length > 0) {
    if (matches.length >= probe.maxResults || scannedCount >= probe.maxVisits) {
      complete = false;
      break;
    }
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const child = frame.cursor;
    if (child === undefined) {
      stack.pop();
      continue;
    }
    const path = [...frame.path, frame.childIndex];
    let address = frame.address;
    if (child instanceof XmlElement) {
      const key = clark({
        namespaceUri: child.namespaceUri,
        localName: child.name,
      });
      const occurrence = (frame.occurrences.get(key) ?? 0) + 1;
      frame.occurrences.set(key, occurrence);
      address = [...frame.address, stepOf(child, occurrence)];
    }
    advance(frame);
    scannedCount += 1;

    if (child instanceof XmlElement) {
      if (wantsAttributes) scanAttributes(child, path, address, probe, matches);
      stack.push(frameFor(child, path, address, 0));
      continue;
    }

    if (!wantsText) continue;
    if (!(child instanceof XmlText) && !(child instanceof XmlCData)) continue;
    const value = child.content;
    const at = matchIndex(value, probe);
    if (at === -1) continue;
    const { snippet, truncated } = snippetOf(value, at, probe.maxChars);
    matches.push({
      nodeId: formatNodeId(path),
      address,
      matchKind: "text",
      snippet,
      ...(truncated ? { snippetTruncated: true as const } : {}),
    });
  }

  const next = complete ? undefined : nextUnvisited(stack);

  return {
    matches,
    scannedCount,
    scopeAddress: scope.address,
    scopePath: scope.path,
    complete,
    ...(next === undefined ? {} : { next }),
  };
}
