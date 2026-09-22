import { describe, expect, it } from "vitest";
import {
  extensionOf,
  normalisePartPath,
  relationshipsPathFor,
  resolveTarget,
} from "../src/index.js";

describe("resolveTarget", () => {
  it("takes an absolute target as a package path", () => {
    expect(resolveTarget("doc/main.xml", "/media/image1.png")).toBe(
      "media/image1.png",
    );
  });

  it("resolves a relative target against the declaring part's folder", () => {
    expect(resolveTarget("doc/main.xml", "notes.xml")).toBe("doc/notes.xml");
    expect(resolveTarget("doc/main.xml", "../media/image1.png")).toBe(
      "media/image1.png",
    );
    expect(resolveTarget("doc/sub/main.xml", "./a/../b.xml")).toBe(
      "doc/sub/b.xml",
    );
  });

  it("resolves a package-root relationship against the root", () => {
    expect(resolveTarget("", "doc/main.xml")).toBe("doc/main.xml");
  });

  it("refuses a target that climbs above the package root", () => {
    expect(resolveTarget("doc/main.xml", "../../escape.xml")).toBeUndefined();
    expect(resolveTarget("", "../escape.xml")).toBeUndefined();
  });
});

describe("part path helpers", () => {
  it("strips a leading slash", () => {
    expect(normalisePartPath("/doc/main.xml")).toBe("doc/main.xml");
    expect(normalisePartPath("doc/main.xml")).toBe("doc/main.xml");
  });

  it("names the relationships part beside its owner", () => {
    expect(relationshipsPathFor("doc/main.xml")).toBe(
      "doc/_rels/main.xml.rels",
    );
    expect(relationshipsPathFor("")).toBe("_rels/.rels");
  });

  it("reads the extension only from the last segment", () => {
    expect(extensionOf("media/image1.PNG")).toBe("PNG");
    expect(extensionOf("doc.v2/main")).toBe("");
    expect(extensionOf("noextension")).toBe("");
  });
});
