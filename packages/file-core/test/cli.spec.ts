import { describe, expect, it } from "vitest";
import { parseServerArgv } from "../src/cli.js";

function outcome(...args: string[]) {
  return parseServerArgv(["node", "server.js", ...args]);
}

describe("parseServerArgv", () => {
  it("takes the single positional argument as the root", () => {
    expect(outcome("/data/sheets")).toEqual({
      kind: "root",
      path: "/data/sheets",
    });
  });

  it("asks for usage when no root is given", () => {
    expect(outcome()).toEqual({ kind: "usage" });
  });

  it("asks for usage when the argument looks like a flag", () => {
    expect(outcome("--help")).toEqual({ kind: "usage" });
    expect(outcome("-h")).toEqual({ kind: "usage" });
  });

  it("asks for usage when a second argument is given", () => {
    expect(outcome("/data/sheets", "extra")).toEqual({ kind: "usage" });
  });

  it("accepts a relative root and a root with spaces", () => {
    expect(outcome("./sheets")).toEqual({ kind: "root", path: "./sheets" });
    expect(outcome("/data/my sheets")).toEqual({
      kind: "root",
      path: "/data/my sheets",
    });
  });
});
