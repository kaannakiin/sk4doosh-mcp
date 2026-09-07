import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileSourceError,
  internalErrorMessage,
  internalErrorRecovery,
  redactRoot,
} from "../src/errors.js";
import type { Vocabulary } from "../src/vocabulary.js";

const vocabulary: Vocabulary<string> = {
  serverName: "probe-mcp",
  subject: "document",
  rootLabel: "document root",
  readableLabel: "readable document",
  listTool: "list_documents",
  tooLargeRecovery: "Read a smaller file.",
};

class ProbeError extends FileSourceError {}

describe("FileSourceError", () => {
  it("takes its name from the concrete subclass", () => {
    expect(new ProbeError("not_a_file", "x").name).toBe("ProbeError");
    expect(new FileSourceError("not_a_file", "x").name).toBe("FileSourceError");
  });

  it("carries the code and the optional recovery", () => {
    const failure = new ProbeError("file_too_large", "too big", "split it");
    expect(failure.code).toBe("file_too_large");
    expect(failure.recovery).toBe("split it");
    expect(new ProbeError("not_a_file", "x").recovery).toBeUndefined();
  });

  it("stays an Error so instanceof narrowing works", () => {
    expect(new ProbeError("not_a_file", "x")).toBeInstanceOf(FileSourceError);
    expect(new ProbeError("not_a_file", "x")).toBeInstanceOf(Error);
  });
});

describe("redactRoot", () => {
  it("removes the root and its separator so a relative remainder survives", () => {
    const detail = `ENOENT: no such file, scandir '${["/data", "sheets", "q1"].join(sep)}'`;
    expect(redactRoot(detail, ["/data", "sheets"].join(sep))).not.toContain(
      "/data",
    );
    expect(redactRoot(detail, ["/data", "sheets"].join(sep))).toContain("q1");
  });

  it("replaces a bare mention of the root with a dot", () => {
    expect(redactRoot("cannot read /data/sheets", "/data/sheets")).toBe(
      "cannot read .",
    );
  });

  it("passes the detail through when no root is known", () => {
    expect(redactRoot("boom", undefined)).toBe("boom");
    expect(redactRoot("boom", "")).toBe("boom");
  });
});

describe("internalErrorMessage", () => {
  it("names the tool when one is given", () => {
    expect(internalErrorMessage(new Error("boom"), { tool: "read_page" })).toBe(
      "read_page failed unexpectedly: boom",
    );
  });

  it("falls back to a generic subject", () => {
    expect(internalErrorMessage(new Error("boom"), {})).toBe(
      "The tool failed unexpectedly: boom",
    );
  });

  it("accepts a throw that is not an Error", () => {
    expect(internalErrorMessage("boom", {})).toContain("boom");
  });

  it("redacts the root from the detail", () => {
    const message = internalErrorMessage(
      new Error("scandir '/data/sheets/q1'"),
      { root: "/data/sheets" },
    );
    expect(message).not.toContain("/data/sheets");
    expect(message).toContain("q1");
  });
});

describe("internalErrorRecovery", () => {
  it("blames the server and never the file", () => {
    const recovery = internalErrorRecovery(vocabulary);
    expect(recovery).toBe(
      "This is a fault in the probe-mcp server, not in the document. Retrying the same call will not help.",
    );
    expect(recovery).not.toContain("re-save");
  });
});
