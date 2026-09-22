import { describe, expect, it } from "vitest";
import {
  createCallerScope,
  deriveCallerScopeKey,
  digestInput,
  type CarrierHeaderLookup,
} from "../src/cache/caller-scope.js";

function headerFrom(
  values: Record<string, string | string[]>,
): CarrierHeaderLookup {
  const lower = new Map(
    Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return (name) => lower.get(name.toLowerCase());
}

describe("digestInput / deriveCallerScopeKey", () => {
  it("C1: is stable across repeated calls with the same carriers", () => {
    const header = headerFrom({ Authorization: "Bearer abc", "X-Tenant": "7" });
    const carriers = ["Authorization", "X-Tenant"];
    const first = deriveCallerScopeKey(digestInput(carriers, header));
    const second = deriveCallerScopeKey(digestInput(carriers, header));
    expect(first).toBe(second);
  });

  it("C2: differs when a declared carrier's value differs, and ignores undeclared headers", () => {
    const carriers = ["Authorization"];
    const base = deriveCallerScopeKey(
      digestInput(carriers, headerFrom({ Authorization: "Bearer abc" })),
    );
    const changed = deriveCallerScopeKey(
      digestInput(carriers, headerFrom({ Authorization: "Bearer xyz" })),
    );
    expect(changed).not.toBe(base);

    const withExtraHeader = deriveCallerScopeKey(
      digestInput(
        carriers,
        headerFrom({ Authorization: "Bearer abc", "X-Untracked": "anything" }),
      ),
    );
    expect(withExtraHeader).toBe(base);
  });

  it("C3: carries no plaintext and is 64 lowercase hex characters", () => {
    const secret = "super-secret-token-value";
    const digest = digestInput(
      ["Authorization"],
      headerFrom({ Authorization: secret }),
    );
    const key = deriveCallerScopeKey(digest);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain(secret);
  });

  it("C4: carrier names are matched case-insensitively", () => {
    const header = headerFrom({ Authorization: "Bearer abc" });
    const lower = deriveCallerScopeKey(digestInput(["authorization"], header));
    const upper = deriveCallerScopeKey(digestInput(["AUTHORIZATION"], header));
    const mixed = deriveCallerScopeKey(digestInput(["Authorization"], header));
    expect(lower).toBe(upper);
    expect(lower).toBe(mixed);
  });

  it("joins multi-valued carriers with ',' and treats an absent carrier as empty", () => {
    const header = headerFrom({ "X-Tag": ["a", "b"] });
    const digest = digestInput(["X-Tag", "X-Missing"], header);
    expect(digest).toBe("x-missing=\nx-tag=a,b\n");
  });
});

describe("createCallerScope", () => {
  it("C5: accepts a valid key and tags", () => {
    const scope = createCallerScope("a".repeat(64), ["user:42", "tenant:7"]);
    expect(scope.key).toBe("a".repeat(64));
    expect(scope.tags).toEqual(["user:42", "tenant:7"]);
  });

  it("C5: rejects an invalid key with RangeError", () => {
    expect(() => createCallerScope("")).toThrow(RangeError);
    expect(() => createCallerScope("has whitespace")).toThrow(RangeError);
    expect(() => createCallerScope("has:colon")).toThrow(RangeError);
  });

  it("C5: rejects a malformed tag with TypeError", () => {
    expect(() => createCallerScope("validkey", ["no-colon"])).toThrow(
      TypeError,
    );
    expect(() => createCallerScope("validkey", ["user: has space"])).toThrow(
      TypeError,
    );
    expect(() => createCallerScope("validkey", [":novalue"])).toThrow(
      TypeError,
    );
    expect(() => createCallerScope("validkey", ["novalue:"])).toThrow(
      TypeError,
    );
    expect(() => createCallerScope("validkey", ["kind:value"])).not.toThrow();
  });
});
