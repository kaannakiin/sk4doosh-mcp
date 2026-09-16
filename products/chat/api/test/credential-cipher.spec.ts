import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { CredentialCipherService } from "../src/connections/credential-cipher.service.ts";

const SECRET = Buffer.alloc(32, 11).toString("base64");

const INTEGRATION = "3f1b0c4e-0000-4000-8000-000000000001";

const OTHER_INTEGRATION = "3f1b0c4e-0000-4000-8000-000000000002";

/**
 * Guard: the same expression the column's CHECK constraint enforces. A change to
 * the header or the algorithm that stops producing this shape would be rejected
 * by Postgres at insert time, which is a far worse place to find out.
 */
const COMPACT_JWE =
  /^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

async function createCipher(): Promise<CredentialCipherService> {
  const module = await Test.createTestingModule({
    providers: [
      CredentialCipherService,
      { provide: ConfigService, useValue: { get: () => SECRET } },
    ],
  }).compile();

  return module.get(CredentialCipherService);
}

describe("CredentialCipherService", () => {
  it("round-trips a credential for its own integration and purpose", async () => {
    const cipher = await createCipher();
    const sealed = await cipher.seal(INTEGRATION, "client_secret", "s3cr3t");

    expect(sealed).not.toContain("s3cr3t");
    await expect(
      cipher.open(INTEGRATION, "client_secret", sealed),
    ).resolves.toBe("s3cr3t");
  });

  it("produces the compact shape the column constraint accepts", async () => {
    const cipher = await createCipher();
    const sealed = await cipher.seal(INTEGRATION, "client_secret", "s3cr3t");

    expect(sealed).toMatch(COMPACT_JWE);
  });

  it("refuses a client secret read as a registration access token", async () => {
    const cipher = await createCipher();
    const sealed = await cipher.seal(INTEGRATION, "client_secret", "s3cr3t");

    await expect(
      cipher.open(INTEGRATION, "registration_access_token", sealed),
    ).resolves.toBeUndefined();
  });

  it("refuses a credential read for another integration", async () => {
    const cipher = await createCipher();
    const sealed = await cipher.seal(INTEGRATION, "client_secret", "s3cr3t");

    await expect(
      cipher.open(OTHER_INTEGRATION, "client_secret", sealed),
    ).resolves.toBeUndefined();
  });

  it("refuses a tampered ciphertext", async () => {
    const cipher = await createCipher();
    const sealed = await cipher.seal(INTEGRATION, "client_secret", "s3cr3t");

    await expect(
      cipher.open(INTEGRATION, "client_secret", `${sealed}x`),
    ).resolves.toBeUndefined();
    await expect(
      cipher.open(INTEGRATION, "client_secret", "not-a-jwe"),
    ).resolves.toBeUndefined();
  });

  it("reports the key version the row must record", async () => {
    const cipher = await createCipher();

    expect(cipher.keyVersion).toBe(1);
  });
});
