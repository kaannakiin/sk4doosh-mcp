import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Fixtures } from "./fixtures/build.js";
import { bodyOf, createHarness, type Harness } from "./fixtures/harness.js";

let fixtures: Fixtures;
let harness: Harness;

async function describeDoc(filePath: string, maxPaths?: number) {
  const result = await harness.handlers.describe_document({
    filePath,
    ...(maxPaths === undefined ? {} : { maxPaths }),
  } as Parameters<Harness["handlers"]["describe_document"]>[0]);
  return { isError: result.isError === true, body: bodyOf(result) };
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  harness = await createHarness(fixtures.root);
});

afterAll(async () => {
  await harness.close();
});

describe("structure discovery", () => {
  it("names the document element by expanded name", async () => {
    const { body } = await describeDoc(basename(fixtures.namespaced));
    expect(body["root"]).toStrictEqual({
      localName: "project",
      namespaceUri: "http://maven.apache.org/POM/4.0.0",
      prefixedName: "project",
    });
  });

  it("offers a query alias for every namespace, default one included", async () => {
    const { body } = await describeDoc(basename(fixtures.namespaceTraps));
    expect(body["namespaces"]).toStrictEqual([
      {
        uri: "urn:default",
        alias: "ns1",
        declaredPrefixes: [],
        synthetic: true,
      },
      {
        uri: "urn:alpha",
        alias: "a",
        declaredPrefixes: ["a"],
        synthetic: false,
      },
      {
        uri: "urn:beta",
        alias: "ns2",
        declaredPrefixes: ["a"],
        synthetic: true,
      },
    ]);
  });

  it("reports the declaration it read and invents no detected encoding", async () => {
    const declared = await describeDoc(basename(fixtures.simple));
    expect(declared.body["declaredEncoding"]).toBe("UTF-8");
    expect(declared.body).not.toHaveProperty("detectedEncoding");

    const silent = await describeDoc(basename(fixtures.legacyProject));
    expect(silent.body["declaredEncoding"]).toBeNull();
  });

  it("marks repetition candidates as counts, not as a schema", async () => {
    const { body } = await describeDoc(basename(fixtures.invoice));
    const candidates = body["repetitionCandidates"] as readonly {
      readonly localName: string;
      readonly count: number;
      readonly countExact: boolean;
    }[];
    const line = candidates.find((entry) => entry.localName === "Line");
    expect(line?.count).toBe(2);
    expect(line?.countExact).toBe(true);
    expect(body["capabilities"]).toMatchObject({
      schemaValidation: false,
      xpath: true,
      write: false,
    });
  });

  it("points at mixed content where it found some", async () => {
    const { body } = await describeDoc(basename(fixtures.mixed));
    expect((body["mixedContent"] as readonly unknown[]).length).toBe(1);

    const plain = await describeDoc(basename(fixtures.invoice));
    expect(plain.body["mixedContent"]).toStrictEqual([]);
  });

  it("states that prolog comments and instructions are not addressable", async () => {
    const { body } = await describeDoc(basename(fixtures.simple));
    expect(String((body["notes"] as readonly string[])[0])).toContain(
      "before the document element",
    );
  });
});

describe("the example address", () => {
  it("hands read_node an address it accepts unchanged", async () => {
    const { body } = await describeDoc(basename(fixtures.invoice));
    const example = body["exampleAddress"];
    const page = await harness.handlers.read_node({
      filePath: basename(fixtures.invoice),
      address: example,
      maxDepth: 1,
    } as Parameters<Harness["handlers"]["read_node"]>[0]);
    const read = bodyOf(page);
    expect(page.isError).toBeUndefined();
    expect(read["scopeAddress"]).toStrictEqual(example);
    expect((read["records"] as readonly { kind: string }[])[0]?.kind).toBe(
      "element",
    );
  });
});

describe("refusals", () => {
  it("refuses a DOCTYPE before the document is parsed", async () => {
    const { isError, body } = await describeDoc(basename(fixtures.doctype));
    expect(isError).toBe(true);
    expect(body["error"]).toBe("doctype_not_allowed");
  });

  it("never turns malformed XML into a summary", async () => {
    const { isError, body } = await describeDoc(basename(fixtures.malformed));
    expect(isError).toBe(true);
    expect(body["error"]).toBe("malformed_xml");
  });
});
