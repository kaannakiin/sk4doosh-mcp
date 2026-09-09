import { basename } from "node:path";
import { writeFile } from "node:fs/promises";
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
  type SandboxedPath,
} from "../src/paths.js";
import { createXmlWorkerPool, type XmlWorkerPool } from "../src/worker-pool.js";

let root: DocumentRoot;
let pool: XmlWorkerPool;
let cache: XmlDocumentCache;
let fixtures: ReturnType<typeof inject<"fixtures">>;

const at = async (absolute: string): Promise<SandboxedPath> =>
  resolveDocumentPath(root, basename(absolute));

async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return (error as SkMcpXmlError).code;
  }
  return "no-error";
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  root = await createDocumentRoot(fixtures.root);
  pool = createXmlWorkerPool({ diagnostics: true });
  cache = createXmlDocumentCache(pool, root.real);
});

afterAll(async () => {
  await pool.close();
});

describe("the document store adapter", () => {
  it("returns only serialisable facts, never a WASM handle", async () => {
    const loaded = await cache.load(await at(fixtures.simple));
    expect(JSON.parse(JSON.stringify(loaded))).toEqual(loaded);
    expect(loaded.root.localName).toBe("catalog");
    expect(loaded.format).toBe("xml");
    expect(typeof loaded.residency).toBe("string");
  });

  it("reports the declared encoding without inventing one", async () => {
    const declared = await cache.load(await at(fixtures.simple));
    expect(declared.declaredEncoding).toBe("UTF-8");
    const silent = await cache.load(await at(fixtures.legacyProject));
    expect(silent.declaredEncoding).toBeNull();
  });

  it("keeps the namespace URI of the root element", async () => {
    const loaded = await cache.load(await at(fixtures.namespaced));
    expect(loaded.root.namespaceUri).toBe("http://maven.apache.org/POM/4.0.0");
  });

  it("refuses a DOCTYPE before the document is ever parsed", async () => {
    expect(
      await codeOf(async () => cache.load(await at(fixtures.doctype))),
    ).toBe("doctype_not_allowed");
  });

  it("accepts a document whose comment merely looks like a DOCTYPE", async () => {
    const loaded = await cache.load(await at(fixtures.doctypeInComment));
    expect(loaded.root.localName).toBe("catalog");
  });

  it("never turns malformed XML into a success", async () => {
    expect(
      await codeOf(async () => cache.load(await at(fixtures.malformed))),
    ).toBe("malformed_xml");
  });

  it("applies the XML byte ceiling, not the shared file ceiling", async () => {
    const oversized = `${fixtures.root}/huge.xml`;
    const filler = "<i>x</i>".repeat(1_200_000);
    await writeFile(oversized, `<r>${filler}</r>`, "utf8");
    expect(await codeOf(async () => cache.load(await at(oversized)))).toBe(
      "file_too_large",
    );
    expect(limits.maxXmlBytes).toBeLessThan(limits.maxFileBytes);
  });
});

describe("resource ownership", () => {
  it("frees the partial context when a parse fails", async () => {
    await pool.ask({ kind: "release" });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await codeOf(async () => cache.load(await at(fixtures.malformed)));
    }
    const diag = await pool.ask({ kind: "diag" });
    expect(diag.ok).toBe(true);
    if (diag.ok) {
      expect(diag.value.live).toBe(0);
      expect(diag.value.cached).toBe(0);
    }
  });

  it("frees the document a refused DOCTYPE produced", async () => {
    await pool.ask({ kind: "release" });
    await codeOf(async () => cache.load(await at(fixtures.doctype)));
    const diag = await pool.ask({ kind: "diag" });
    if (diag.ok) {
      expect(diag.value.live).toBe(0);
    }
  });

  it("holds no more live documents than the worker capacity", async () => {
    await pool.ask({ kind: "release" });
    cache.clear();
    const paths = [
      fixtures.simple,
      fixtures.namespaced,
      fixtures.legacyProject,
      fixtures.doctypeInComment,
      fixtures.nested,
    ];
    for (const path of paths) {
      await cache.load(
        await resolveDocumentPath(root, path.slice(fixtures.root.length + 1)),
      );
    }
    const diag = await pool.ask({ kind: "diag" });
    if (diag.ok) {
      expect(diag.value.cached).toBeLessThanOrEqual(limits.workerCacheEntries);
      expect(diag.value.live).toBe(diag.value.cached);
      expect(diag.value.collected).toBe(0);
    }
  });

  it("supersedes the old document when the content changes", async () => {
    await pool.ask({ kind: "release" });
    cache.clear();
    const churn = `${fixtures.root}/churn.xml`;
    await writeFile(churn, "<r><a/></r>", "utf8");
    const first = await cache.load(await at(churn));
    await writeFile(churn, "<r><b/></r>", "utf8");
    const second = await cache.load(await at(churn));
    expect(second.stamp).not.toBe(first.stamp);
    const diag = await pool.ask({ kind: "diag" });
    if (diag.ok) {
      expect(diag.value.cached).toBe(1);
      expect(diag.value.live).toBe(1);
    }
  });

  it("releases everything on shutdown", async () => {
    await cache.load(await at(fixtures.simple));
    await pool.ask({ kind: "release" });
    const diag = await pool.ask({ kind: "diag" });
    if (diag.ok) {
      expect(diag.value.live).toBe(0);
      expect(diag.value.cached).toBe(0);
      expect(diag.value.collected).toBe(0);
    }
  });
});
