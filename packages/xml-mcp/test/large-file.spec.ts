import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { limits } from "../src/limits.js";
import { bodyOf, createHarness, type Harness } from "./fixtures/harness.js";

const enabled = process.env["SKMCP_XML_LARGE"] === "1";

const mib = 1024 * 1024;

let root: string;
let harness: Harness;

const catalogue = {
  ancestors: [{ namespaceUri: "", localName: "catalogue" }],
  name: { namespaceUri: "", localName: "entry" },
};

const codeColumn = {
  label: "code",
  value: { from: "attribute", namespaceUri: "", localName: "code" },
};

async function writeRepeating(
  name: string,
  targetBytes: number,
): Promise<void> {
  const parts: string[] = ["<catalogue>"];
  let size = 0;
  for (let i = 0; size < targetBytes; i += 1) {
    const record = `<entry code="c${String(i)}"><name>n${String(i)}</name><pad>${"z".repeat(200)}</pad></entry>`;
    parts.push(record);
    size += record.length;
  }
  parts.push("</catalogue>\n");
  await writeFile(join(root, name), parts.join(""), "utf8");
}

async function writeIrregular(
  name: string,
  targetBytes: number,
): Promise<void> {
  const depth = 60;
  const parts: string[] = ["<tree>"];
  let size = 0;
  for (let i = 0; size < targetBytes; i += 1) {
    const branch =
      `<b${String(i % depth)}>`.repeat(1) +
      `<leaf>${"y".repeat(300)}</leaf>` +
      `</b${String(i % depth)}>`;
    parts.push(branch);
    size += branch.length;
  }
  parts.push("</tree>\n");
  await writeFile(join(root, name), parts.join(""), "utf8");
}

beforeAll(async () => {
  if (!enabled) return;
  root = await mkdtemp(join(tmpdir(), "xml-mcp-large-"));
  await writeRepeating("records-40mib.xml", 40 * mib);
  await writeIrregular("irregular-40mib.xml", 40 * mib);
  await writeFile(
    join(root, "oversized-record.xml"),
    `<catalogue><entry code="a"><pad>${"z".repeat(9 * mib)}</pad></entry><entry code="b"/></catalogue>\n`,
    "utf8",
  );
  harness = await createHarness(root);
}, 300_000);

afterAll(async () => {
  if (!enabled) return;
  await harness.close();
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!enabled)("above the resident budget", () => {
  it("answers a record-shaped 40 MiB document, declaring the scan budget", async () => {
    const body = bodyOf(
      await harness.handlers.project_records({
        filePath: "records-40mib.xml",
        itemAddress: catalogue,
        columns: [codeColumn],
        maxRows: 5,
      } as Parameters<Harness["handlers"]["project_records"]>[0]),
    );
    expect(body["mode"]).toBe("chunked");
    const rows = body["rows"] as readonly Record<string, unknown>[];
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ occurrence: 1 });
    expect(body["totalItems"]).toBe(limits.maxItemVisits);
    expect(body["totalItemsExact"]).toBe(false);
    expect(body["complete"]).toBe(false);
  }, 300_000);

  it("describes a 40 MiB document without parsing it whole", async () => {
    const body = bodyOf(
      await harness.handlers.describe_document({
        filePath: "records-40mib.xml",
      }),
    );
    expect(body["mode"]).toBe("chunked");
    expect(body["root"]).toMatchObject({ localName: "catalogue" });
    expect(body["repetitionCandidates"]).toContainEqual(
      expect.objectContaining({ localName: "entry" }),
    );
  }, 300_000);

  it("refuses a 40 MiB irregular tree with a repair", async () => {
    const result = await harness.handlers.project_records({
      filePath: "irregular-40mib.xml",
      itemAddress: catalogue,
      columns: [codeColumn],
    } as Parameters<Harness["handlers"]["project_records"]>[0]);
    expect(result.isError).toBe(true);
    const body = bodyOf(result);
    expect(body["error"]).toBe("unsupported_for_format");
    expect(body["recovery"]).toContain("describe_document");
  }, 300_000);

  it("refuses a record that alone exceeds the chunk budget", async () => {
    const result = await harness.handlers.project_records({
      filePath: "oversized-record.xml",
      itemAddress: catalogue,
      columns: [codeColumn],
    } as Parameters<Harness["handlers"]["project_records"]>[0]);
    expect(result.isError).toBe(true);
    const body = bodyOf(result);
    expect(body["error"]).toBe("resource_limit");
    expect(body["message"]).toContain(String(limits.maxChunkBytes));
  }, 300_000);
});
