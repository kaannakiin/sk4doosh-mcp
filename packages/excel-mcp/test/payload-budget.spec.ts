import { basename } from "node:path";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { createWorkbookRoot } from "../src/paths.js";
import { createHandlers, type ToolHandlers } from "../src/tools.js";
import { limits } from "../src/limits.js";

let handlers: ToolHandlers;
let longStrings: string;

function textOf(result: { content: readonly unknown[] }): string {
  const first = result.content[0] as { type: string; text: string };
  return first.text;
}

beforeAll(async () => {
  const fixtures = inject("fixtures");
  handlers = createHandlers(await createWorkbookRoot(fixtures.root));
  longStrings = basename(fixtures.longStrings);
});

describe("every response stays inside the payload budget", () => {
  it("bounds a truncated read_sheet page including its envelope", async () => {
    const result = await handlers.read_sheet({ filePath: longStrings });
    expect(result.isError).toBeUndefined();
    const bytes = Buffer.byteLength(textOf(result), "utf8");
    expect(bytes).toBeLessThanOrEqual(limits.maxPayloadBytes);
  });

  it("still reports the payload cap as the reason it stopped", async () => {
    const result = await handlers.read_sheet({
      filePath: longStrings,
      maxCells: limits.maxCellsHard,
    });
    const payload = JSON.parse(textOf(result)) as {
      truncated: boolean;
      truncationReason?: string;
      returnedCells: number;
    };
    expect(payload.truncated).toBe(true);
    expect(payload.truncationReason).toBe("maxPayloadBytes");
    expect(payload.returnedCells).toBeLessThan(limits.maxCellsHard);
  });

  it("bounds every page of a cursor walk", async () => {
    let cursor: string | undefined;
    for (let page = 0; page < 4; page += 1) {
      const result = await handlers.read_sheet({
        filePath: longStrings,
        ...(cursor === undefined ? {} : { cursor }),
      });
      expect(Buffer.byteLength(textOf(result), "utf8")).toBeLessThanOrEqual(
        limits.maxPayloadBytes,
      );
      const payload = JSON.parse(textOf(result)) as {
        nextCursor?: string;
        returnedRows: number;
      };
      expect(payload.returnedRows).toBeGreaterThan(0);
      if (payload.nextCursor === undefined) {
        break;
      }
      cursor = payload.nextCursor;
    }
  });
});
