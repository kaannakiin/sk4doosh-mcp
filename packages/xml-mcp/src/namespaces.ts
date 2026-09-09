import { XmlElement } from "libxml2-wasm";
import { firstChildOf, nextSibling } from "./traverse.js";

export const XML_RESERVED_URI = "http://www.w3.org/XML/1998/namespace";

export interface NamespaceAlias {
  readonly uri: string;
  readonly alias: string;
  readonly declaredPrefixes: readonly string[];
  readonly synthetic: boolean;
}

export interface NamespaceSurvey {
  readonly aliases: readonly NamespaceAlias[];
  readonly visited: number;
  readonly complete: boolean;
}

interface Seen {
  readonly order: number;
  readonly prefixes: Map<string, number>;
}

function note(seen: Map<string, Seen>, uri: string, prefix?: string): void {
  if (uri === "") return;
  let entry = seen.get(uri);
  if (entry === undefined) {
    entry = { order: seen.size, prefixes: new Map() };
    seen.set(uri, entry);
  }
  if (prefix !== undefined && prefix !== "") {
    entry.prefixes.set(prefix, (entry.prefixes.get(prefix) ?? 0) + 1);
  }
}

function preferredPrefix(prefixes: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [prefix, count] of prefixes) {
    if (count > bestCount) {
      best = prefix;
      bestCount = count;
    }
  }
  return best;
}

export function surveyNamespaces(
  root: XmlElement,
  maxVisits: number,
): NamespaceSurvey {
  const seen = new Map<string, Seen>();
  const stack: XmlElement[] = [root];
  let visited = 0;
  let complete = true;

  while (stack.length > 0) {
    const element = stack.pop();
    if (element === undefined) break;
    if (visited >= maxVisits) {
      complete = false;
      break;
    }
    visited += 1;

    note(seen, element.namespaceUri, element.prefix);
    for (const [prefix, uri] of Object.entries(element.nsDeclarations)) {
      note(seen, uri, prefix);
    }
    for (const attribute of element.attrs) {
      note(seen, attribute.namespaceUri, attribute.prefix);
    }

    const children: XmlElement[] = [];
    for (
      let child = firstChildOf(element);
      child !== undefined;
      child = nextSibling(child)
    ) {
      if (child instanceof XmlElement) children.push(child);
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) stack.push(child);
    }
  }

  const ordered = [...seen.entries()].sort(
    ([, left], [, right]) => left.order - right.order,
  );
  const taken = new Set<string>();
  const aliases: NamespaceAlias[] = [];
  let synthetic = 0;

  for (const [uri, entry] of ordered) {
    const declaredPrefixes = [...entry.prefixes.keys()].sort();
    const candidate =
      uri === XML_RESERVED_URI ? "xml" : preferredPrefix(entry.prefixes);
    let alias: string;
    if (candidate !== undefined && !taken.has(candidate)) {
      alias = candidate;
    } else {
      do {
        synthetic += 1;
        alias = `ns${String(synthetic)}`;
      } while (taken.has(alias));
    }
    taken.add(alias);
    aliases.push({
      uri,
      alias,
      declaredPrefixes,
      synthetic: alias !== candidate,
    });
  }

  return { aliases, visited, complete };
}
