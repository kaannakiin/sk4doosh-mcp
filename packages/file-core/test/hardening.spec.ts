import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFormatRegistry } from "../src/formats.js";
import { FileSourceError, redactRoot } from "../src/errors.js";
import { toToolError } from "../src/tools.js";
import { createSandboxRoot, type SandboxRoot } from "../src/paths.js";
import { listSources } from "../src/listing.js";

const vocabulary = {
  serverName: "probe",
  subject: "document",
  rootLabel: "document root",
  readableLabel: "document",
  listTool: "list_documents",
  tooLargeRecovery: "Read a smaller file.",
};
const fail = (code: string, message: string) =>
  new FileSourceError(code, message);
const registry = createFormatRegistry(
  { ".xlsx": "xlsx", ".xlsm": "xlsx", ".csv": "csv" },
  vocabulary,
  fail,
);

describe("independent format registry (#18)", () => {
  it("resolves formats, rejects extensions and deduplicates format names", () => {
    expect(registry.names).toEqual(["xlsx", "csv"]);
    expect(registry.formatFor("Mixed.XLSM")).toBe("xlsx");
    expect(registry.formatFor("table.csv")).toBe("csv");
    expect(() => registry.formatFor("bad.exe")).toThrow(
      expect.objectContaining({ code: "unsupported_extension" }),
    );
  });
});
describe("error boundary (#7 #29)", () => {
  it.each([
    [
      "/srv/root",
      "open '/srv/root/file.xlsx' and '/srv/root-evil/secret' and '/other/private'",
      ["srv", "secret", "private"],
    ],
    [
      "C:\\data\\root",
      "open 'C:\\data\\root\\book.xlsx' and 'C:\\data\\root-evil\\secret'",
      ["C:", "secret"],
    ],
    ["/srv/root", "open '/srv/root'", ["/srv/root"]],
  ] as const)(
    "redacts root, sibling and unrelated paths with root %s",
    (root, message, forbidden) => {
      const serialized = JSON.stringify(
        toToolError(new FileSourceError("corrupt_workbook", message, message), {
          root,
        }),
      );
      for (const value of forbidden) expect(serialized).not.toContain(value);
    },
  );
  it("preserves recovery URLs and relative paths", () => {
    expect(
      redactRoot(
        "open '/srv/my root/book.xlsx' and '/srv/my root-evil/secret file'",
        "/srv/my root",
      ),
    ).toBe("open 'book.xlsx' and '[path]'");
    expect(
      redactRoot(
        "See https://example.com/docs and 'q1/book.xlsx'",
        "/srv/root",
      ),
    ).toBe("See https://example.com/docs and 'q1/book.xlsx'");
  });
});
describe("listing budgets and exactness (#19 #34)", () => {
  let directory: string;
  let root: SandboxRoot;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "listing-hardening-"));
    for (let i = 0; i < 6; i += 1)
      await writeFile(join(directory, `${i}.csv`), "a");
    root = await createSandboxRoot(directory, {
      formats: registry,
      vocabulary,
      fail,
      maxListScan: 5,
    });
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("distinguishes traversal truncation from a result page", async () => {
    const scan = await listSources(root, { maxResults: 10 });
    expect(scan).toMatchObject({
      total: 5,
      totalExact: false,
      scanTruncated: true,
      scanTruncationReason: "entries",
      truncated: false,
    });
    const page = await listSources(
      { ...root, maxListScan: 10 },
      { maxResults: 1 },
    );
    expect(page).toMatchObject({
      total: 6,
      totalExact: true,
      scanTruncated: false,
      truncated: true,
    });
  });
  it.each([5, 6, 7])(
    "is conservative at the entry budget %s",
    async (maxListScan) => {
      const result = await listSources(
        { ...root, maxListScan },
        { maxResults: 10 },
      );
      expect(result.total).toBe(Math.min(6, maxListScan));
      expect(result.totalExact).toBe(maxListScan > 6);
    },
  );
});
