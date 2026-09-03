import { describe, expect, it } from "vitest";
import { createCallerScope } from "../src/cache/caller-scope.js";
import { flattenCacheKey, type CacheKey } from "../src/cache/cache.js";
import { MemorySkMcpCache } from "../src/cache/memory-cache.js";

describe("MemorySkMcpCache", () => {
  it("M1: TTL is absolute from the scope's first write and does not slide", async () => {
    let now = 0;
    const cache = new MemorySkMcpCache({
      lifetimeMs: 100,
      maxCallers: 10,
      now: () => now,
    });
    const scope = createCallerScope("scope-a");
    const facts: CacheKey = { scope, kind: "facts" };

    await cache.set(facts, "v1");

    now = 50;
    await cache.set({ scope, kind: "probe", subkey: "tool_a" }, "A");
    expect(await cache.get(facts)).toBe("v1");

    now = 99;
    expect(await cache.get(facts)).toBe("v1");

    now = 100;
    expect(await cache.get(facts)).toBeUndefined();
  });

  it("M2: evicts the least recently used scope only when a new scope is admitted over capacity", async () => {
    const cache = new MemorySkMcpCache({ lifetimeMs: 100_000, maxCallers: 2 });
    const a = createCallerScope("scope-a");
    const b = createCallerScope("scope-b");
    const c = createCallerScope("scope-c");

    await cache.set({ scope: a, kind: "facts" }, "A");
    await cache.set({ scope: b, kind: "facts" }, "B");
    expect(await cache.get({ scope: a, kind: "facts" })).toBe("A");

    await cache.set({ scope: c, kind: "facts" }, "C");

    expect(await cache.get({ scope: b, kind: "facts" })).toBeUndefined();
    expect(await cache.get({ scope: a, kind: "facts" })).toBe("A");
    expect(await cache.get({ scope: c, kind: "facts" })).toBe("C");
  });

  it("M3: removeScope drops every kind cached for that scope", async () => {
    const cache = new MemorySkMcpCache({ lifetimeMs: 1000, maxCallers: 10 });
    const scope = createCallerScope("scope-a");
    await cache.set({ scope, kind: "facts" }, "F");
    await cache.set({ scope, kind: "probe", subkey: "tool_a" }, "A");

    await cache.removeScope(scope.key);

    expect(await cache.get({ scope, kind: "facts" })).toBeUndefined();
    expect(
      await cache.get({ scope, kind: "probe", subkey: "tool_a" }),
    ).toBeUndefined();
  });

  it("M4: removeTag drops every scope carrying that tag, and none other", async () => {
    const cache = new MemorySkMcpCache({ lifetimeMs: 1000, maxCallers: 10 });
    const alice1 = createCallerScope("alice-session-1", ["user:alice"]);
    const alice2 = createCallerScope("alice-session-2", ["user:alice"]);
    const bob = createCallerScope("bob-session", ["user:bob"]);

    await cache.set({ scope: alice1, kind: "facts" }, "A1");
    await cache.set({ scope: alice2, kind: "facts" }, "A2");
    await cache.set({ scope: bob, kind: "facts" }, "B");

    await cache.removeTag("user:alice");

    expect(await cache.get({ scope: alice1, kind: "facts" })).toBeUndefined();
    expect(await cache.get({ scope: alice2, kind: "facts" })).toBeUndefined();
    expect(await cache.get({ scope: bob, kind: "facts" })).toBe("B");
  });

  it("M5: clear removes every scope", async () => {
    const cache = new MemorySkMcpCache({ lifetimeMs: 1000, maxCallers: 10 });
    const a = createCallerScope("scope-a", ["user:a"]);
    const b = createCallerScope("scope-b", ["user:b"]);
    await cache.set({ scope: a, kind: "facts" }, "A");
    await cache.set({ scope: b, kind: "facts" }, "B");

    await cache.clear();

    expect(await cache.get({ scope: a, kind: "facts" })).toBeUndefined();
    expect(await cache.get({ scope: b, kind: "facts" })).toBeUndefined();
    await expect(cache.removeTag("user:a")).resolves.toBeUndefined();
  });

  it("M6: keys flatten to skmcp:v1:{scope}:{kind}[:{subkey}]", () => {
    const scope = createCallerScope("a".repeat(64));
    expect(flattenCacheKey({ scope, kind: "facts" })).toBe(
      `skmcp:v1:${scope.key}:facts`,
    );
    expect(
      flattenCacheKey({ scope, kind: "probe", subkey: "search_orders" }),
    ).toBe(`skmcp:v1:${scope.key}:probe:search_orders`);
  });

  it("lifetimeMs 0 makes set a no-op and get always miss", async () => {
    const cache = new MemorySkMcpCache({ lifetimeMs: 0, maxCallers: 10 });
    const scope = createCallerScope("scope-a");
    await cache.set({ scope, kind: "facts" }, "F");
    expect(await cache.get({ scope, kind: "facts" })).toBeUndefined();
  });
});
