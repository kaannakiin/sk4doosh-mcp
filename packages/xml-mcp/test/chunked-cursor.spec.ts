import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { isRefusal, scanRecordBoundaries } from "../src/boundary.js";
import type { Fixtures } from "./fixtures/build.js";
import { bodyOf, createHarness, type Harness } from "./fixtures/harness.js";

let fixtures: Fixtures;
let chunked: Harness;

const catalogue = {
  ancestors: [{ namespaceUri: "", localName: "catalogue" }],
  name: { namespaceUri: "", localName: "entry" },
};

const selector = {
  ancestors: [{ namespaceUri: "", localName: "catalogue", occurrence: 1 }],
  name: { namespaceUri: "", localName: "entry" },
};

const codeColumn = {
  label: "code",
  value: { from: "attribute", namespaceUri: "", localName: "code" },
};

type ProjectArgs = Parameters<Harness["handlers"]["project_records"]>[0];

async function page(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return bodyOf(await chunked.handlers.project_records(args as ProjectArgs));
}

function decode(cursor: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

async function walk(
  filePath: string,
  maxRows: number,
): Promise<readonly number[]> {
  const seen: number[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 200; guard += 1) {
    const body = await page({
      filePath,
      itemAddress: catalogue,
      columns: [codeColumn],
      maxRows,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const row of body["rows"] as readonly Record<string, unknown>[])
      seen.push(row["occurrence"] as number);
    const next = body["nextCursor"];
    if (typeof next !== "string") return seen;
    cursor = next;
  }
  throw new Error("the walk did not terminate");
}

beforeAll(async () => {
  fixtures = inject("fixtures");
  chunked = await createHarness(fixtures.root, undefined, 1);
});

afterAll(async () => {
  await chunked.close();
});

describe("paging the chunked tier", () => {
  it("visits every record exactly once", async () => {
    const seen = await walk(basename(fixtures.wideQuery), 25);
    expect(seen).toHaveLength(300);
    expect(new Set(seen).size).toBe(300);
    expect(seen).toStrictEqual(
      Array.from({ length: 300 }, (_, index) => index + 1),
    );
  });

  it("carries a byte hint that lands on the record the page resumes at", async () => {
    const body = await page({
      filePath: basename(fixtures.wideQuery),
      itemAddress: catalogue,
      columns: [codeColumn],
      maxRows: 10,
    });
    const cursor = decode(body["nextCursor"] as string);
    expect(cursor["i"]).toBe(10);
    const hinted = cursor["b"] as number;
    expect(Number.isSafeInteger(hinted)).toBe(true);

    const bytes = await readFile(fixtures.wideQuery);
    const scan = scanRecordBoundaries(bytes, selector, {
      maxRecordBytes: 1024 * 1024,
      maxSpans: 1000,
    });
    if (isRefusal(scan)) throw new Error(scan.reason);
    expect(hinted).toBe(scan.offsets[10 * 2]);
  });
});

describe("a forged byte hint is never trusted", () => {
  it.each([-1, 0, 3, 7, 999_999, 1.5])(
    "falls back to the hint-free page for b=%s",
    async (forged) => {
      const first = await page({
        filePath: basename(fixtures.wideQuery),
        itemAddress: catalogue,
        columns: [codeColumn],
        maxRows: 10,
      });
      const honest = decode(first["nextCursor"] as string);
      const truthful = await page({
        filePath: basename(fixtures.wideQuery),
        itemAddress: catalogue,
        cursor: first["nextCursor"] as string,
        columns: [codeColumn],
        maxRows: 10,
      });

      const forgedCursor = Buffer.from(
        JSON.stringify({ ...honest, b: forged }),
        "utf8",
      ).toString("base64url");
      const result = await chunked.handlers.project_records({
        filePath: basename(fixtures.wideQuery),
        itemAddress: catalogue,
        cursor: forgedCursor,
        columns: [codeColumn],
        maxRows: 10,
      } as ProjectArgs);

      if (result.isError === true) {
        expect(bodyOf(result)["error"]).toBe("invalid_cursor");
        return;
      }
      expect(bodyOf(result)["rows"]).toStrictEqual(truthful["rows"]);
    },
  );
});
