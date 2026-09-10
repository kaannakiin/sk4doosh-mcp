import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  createXmlDocumentCache,
  type XmlDocumentCache,
} from "../src/document.js";
import type { SkMcpXmlError } from "../src/errors.js";
import { limits } from "../src/limits.js";
import {
  createDocumentRoot,
  resolveDocumentPath,
  type DocumentRoot,
} from "../src/paths.js";
import { createXmlWorkerPool, type XmlWorkerPool } from "../src/worker-pool.js";

const token = "SKMCP-EXTERNAL-IO-CANARY-4f21b8";

let root: DocumentRoot;
let pool: XmlWorkerPool;
let cache: XmlDocumentCache;
let insideUrl: string;
let outsideUrl: string;
let outsideXmlUrl: string;

async function write(name: string, source: string): Promise<string> {
  const fixtures = inject("fixtures");
  await writeFile(join(fixtures.root, name), source, "utf8");
  return name;
}

async function readEverything(name: string): Promise<string> {
  const path = await resolveDocumentPath(root, basename(name));
  const loaded = await cache.load(path);
  const page = await cache.ask(path, loaded.stamp, (stamp) => ({
    kind: "read" as const,
    stamp,
    view: {
      maxDepth: limits.maxDomDepth,
      maxNodes: limits.maxReadNodes,
      maxChars: limits.maxStringChars,
    },
  }));
  return JSON.stringify(page);
}

async function codeOf(name: string): Promise<string> {
  try {
    const path = await resolveDocumentPath(root, basename(name));
    await cache.load(path);
  } catch (error) {
    return (error as SkMcpXmlError).code;
  }
  return "no-error";
}

beforeAll(async () => {
  const fixtures = inject("fixtures");
  root = await createDocumentRoot(fixtures.root);
  pool = createXmlWorkerPool({ diagnostics: true });
  cache = createXmlDocumentCache(pool, root.real);

  const inside = join(fixtures.root, "canary-inside.txt");
  await writeFile(inside, token, "utf8");
  insideUrl = pathToFileURL(inside).href;

  const elsewhere = await mkdtemp(join(tmpdir(), "skmcp-canary-"));
  const outside = join(elsewhere, "canary-outside.txt");
  await writeFile(outside, token, "utf8");
  outsideUrl = pathToFileURL(outside).href;

  const outsideXml = join(elsewhere, "canary-outside.xml");
  await writeFile(outsideXml, `<canary>${token}</canary>`, "utf8");
  outsideXmlUrl = pathToFileURL(outsideXml).href;
});

afterAll(async () => {
  await pool.close();
});

describe("external resource resolution", () => {
  it("refuses every document that declares a DOCTYPE, wherever the entity points", async () => {
    const cases = [
      `<!DOCTYPE r [<!ENTITY xxe SYSTEM "${insideUrl}">]><r>&xxe;</r>`,
      `<!DOCTYPE r [<!ENTITY xxe SYSTEM "${outsideUrl}">]><r>&xxe;</r>`,
      `<!DOCTYPE r [<!ENTITY xxe SYSTEM "canary-inside.txt">]><r>&xxe;</r>`,
      `<!DOCTYPE r [<!ENTITY % pe SYSTEM "${outsideUrl}"> %pe;]><r/>`,
      `<!DOCTYPE r SYSTEM "${outsideUrl}"><r/>`,
    ];
    for (const [index, source] of cases.entries()) {
      const name = await write(`canary-doctype-${String(index)}.xml`, source);
      expect(await codeOf(name)).toBe("doctype_not_allowed");
    }
  });

  it("never surfaces canary content through an XInclude of a well-formed document", async () => {
    const name = await write(
      "canary-xinclude-xml.xml",
      `<r xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="${outsideXmlUrl}"/></r>`,
    );
    expect(await readEverything(name)).not.toContain(token);
  });

  it("never surfaces canary content through an XInclude of a text file", async () => {
    const name = await write(
      "canary-xinclude-text.xml",
      `<r xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="${outsideUrl}" parse="text"/><xi:include href="${insideUrl}" parse="text"/></r>`,
    );
    expect(await readEverything(name)).not.toContain(token);
  });

  it("never surfaces canary content through a schema location hint", async () => {
    const name = await write(
      "canary-schemalocation.xml",
      `<r xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:x ${outsideUrl}" xsi:noNamespaceSchemaLocation="${insideUrl}"/>`,
    );
    expect(await readEverything(name)).not.toContain(token);
  });

  it("never surfaces canary content through a catalog processing instruction", async () => {
    const name = await write(
      "canary-catalog.xml",
      `<?oasis-xml-catalog catalog="${outsideUrl}"?><r/>`,
    );
    expect(await readEverything(name)).not.toContain(token);
  });

  it("keeps serving normal documents after every canary attempt", async () => {
    const name = await write(
      "canary-healthy.xml",
      `<r><entry id="1">plain</entry></r>`,
    );
    const page = await readEverything(name);
    expect(page).toContain("plain");
    expect(page).not.toContain(token);
  });
});
