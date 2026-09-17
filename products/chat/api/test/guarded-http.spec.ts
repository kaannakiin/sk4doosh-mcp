import { describe, expect, it } from "vitest";

import {
  publicOnlyLookup,
  RefusedAddressError,
} from "../src/connections/guarded-http.ts";

function resolve(
  hostname: string,
  policy: { allowLoopback: boolean },
  all = false,
): Promise<{ error: Error | null; value: unknown }> {
  return new Promise((done) => {
    publicOnlyLookup(policy)(
      hostname,
      { all },
      (error: Error | null, value: unknown) => done({ error, value }),
    );
  });
}

describe("publicOnlyLookup", () => {
  it("refuses a name that resolves to loopback when loopback is not allowed", async () => {
    const { error } = await resolve("localhost", { allowLoopback: false });

    expect(error).toBeInstanceOf(RefusedAddressError);
    expect(error?.message).toContain("outside the public internet");
  });

  it("allows the same name once the caller states the policy", async () => {
    const { error, value } = await resolve("localhost", {
      allowLoopback: true,
    });

    expect(error).toBeNull();
    expect(value).toMatch(/^(127\.0\.0\.1|::1)$/u);
  });

  /**
   * Guard: the address the connector receives is one this function inspected.
   * Handing back the name, or resolving again after the check, is what leaves
   * the window a rebinding answer needs.
   */
  it("hands back only addresses it inspected, never the name", async () => {
    const { value } = await resolve("localhost", { allowLoopback: true }, true);

    expect(Array.isArray(value)).toBe(true);
    for (const entry of value as { address: string }[]) {
      expect(entry.address).toMatch(/^(127\.0\.0\.1|::1)$/u);
    }
  });

  it("reports a name that does not resolve as an error rather than allowing it", async () => {
    const { error } = await resolve("no-such-host.invalid", {
      allowLoopback: true,
    });

    expect(error).not.toBeNull();
  });
});
