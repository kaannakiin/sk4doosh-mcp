import { describe, expect, it } from "vitest";
import { projectDiag } from "../src/worker-protocol.js";

describe("the diagnostics projection", () => {
  it("keeps engine pointers out of the reply", () => {
    const raw = {
      XmlDocument: {
        totalInstances: 2,
        garbageCollected: 0,
        _ptr: 300_976,
        _xpathSource: "//i",
      },
    };
    const projected = projectDiag(raw, 2);
    expect(projected).toEqual({ live: 2, collected: 0, cached: 2 });
    expect(JSON.stringify(projected)).not.toContain("_ptr");
    expect(JSON.stringify(projected)).not.toContain("//i");
  });

  it("sums every tracked class", () => {
    expect(
      projectDiag(
        {
          XmlDocument: { totalInstances: 3, garbageCollected: 1 },
          XmlXPath: { totalInstances: 2, garbageCollected: 0 },
        },
        3,
      ),
    ).toEqual({ live: 5, collected: 1, cached: 3 });
  });

  it("reads an empty report as nothing live", () => {
    expect(projectDiag({}, 0)).toEqual({ live: 0, collected: 0, cached: 0 });
  });
});
