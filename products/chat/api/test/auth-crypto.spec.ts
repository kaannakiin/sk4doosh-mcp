import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { AuthCryptoService } from "../src/auth/auth-crypto.service.ts";

const authConfig = {
  secret: Buffer.alloc(32, 7).toString("base64"),
  publicApiUrl: "http://localhost:3000",
  webRedirectUrl: "http://localhost:4200/auth/callback",
  cookieSecure: false,
};

async function createCrypto(): Promise<AuthCryptoService> {
  const module = await Test.createTestingModule({
    providers: [
      AuthCryptoService,
      {
        provide: ConfigService,
        useValue: { get: () => authConfig },
      },
    ],
  }).compile();

  return module.get(AuthCryptoService);
}

describe("AuthCryptoService", () => {
  it("round-trips access-token identity and rejects tampering", async () => {
    const crypto = await createCrypto();
    const identity = {
      userPublicId: "01994cf1-dbbc-7a38-9282-0a1083ed4a2f",
      sessionPublicId: "01994cf1-dbbc-7a38-9282-0a1083ed4a30",
    };
    const token = await crypto.signAccess(identity);

    await expect(crypto.verifyAccess(token)).resolves.toEqual(identity);
    await expect(crypto.verifyAccess(`${token}x`)).resolves.toBeUndefined();
  });

  it("creates salted six-digit OTP hashes", async () => {
    const crypto = await createCrypto();
    const first = crypto.createOtp();
    const second = crypto.createOtp();

    expect(first.code).toMatch(/^\d{6}$/u);
    expect(crypto.verifyOtp(first.encodedHash, first.code)).toBe(true);
    expect(crypto.verifyOtp(first.encodedHash, "999999")).toBe(
      first.code === "999999",
    );
    expect(first.encodedHash).not.toEqual(second.encodedHash);
  });

  it("seals OAuth state for one audience only", async () => {
    const crypto = await createCrypto();
    const token = await crypto.seal("oauth-state", { state: "secret-state" }, 60_000);

    await expect(crypto.unseal("oauth-state", token)).resolves.toMatchObject({
      state: "secret-state",
    });
    await expect(crypto.unseal("oauth-pending", token)).resolves.toBeUndefined();
  });
});
