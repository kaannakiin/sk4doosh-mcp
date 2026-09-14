import { describe, expect, it } from "vitest";

import { PasswordService } from "../src/auth/password.service.ts";

describe("PasswordService", () => {
  it("hashes and verifies with Argon2id", async () => {
    const service = new PasswordService();
    const encoded = await service.hash("a sufficiently long password");

    expect(encoded).toMatch(/^\$argon2id\$/u);
    await expect(
      service.verify(encoded, "a sufficiently long password"),
    ).resolves.toBe(true);
    await expect(service.verify(encoded, "incorrect password")).resolves.toBe(
      false,
    );
    expect(service.needsRehash(encoded)).toBe(false);
  });

  it("burns the dummy hash for unknown accounts", async () => {
    const service = new PasswordService();

    await expect(service.burnDummy("unknown account password")).resolves.toBeUndefined();
  });
});
