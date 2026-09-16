import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EncryptJWT, jwtDecrypt } from "jose";

import { deriveSha256Key } from "../common/utils/crypto.utils.ts";
import type { AppConfig } from "../config/configuration.ts";

const ISSUER = "chat:integration-credential";

const KEY_LABEL = "chat-integration-credential";

/**
 * Guard: the only version this build can read or write. `CHAT_AUTH_SECRET` is a
 * single value with no keyring behind it, so rotation is not yet possible — the
 * version is recorded per row so that rotation can be added without having to
 * guess which rows were written under the retired key.
 */
const KEY_VERSION = 1;

export type CredentialPurpose =
  | "client_secret"
  | "registration_access_token"
  | "code_verifier"
  | "access_token"
  | "refresh_token";

type CredentialSubject = "integration" | "attempt" | "connection";

/**
 * Guard: the subject is derived from the purpose rather than passed alongside
 * it. A client secret belongs to an integration and an access token to one
 * user's connection; if the caller chose both halves, sealing a connection's
 * token under an integration would produce a header that opens for every user
 * of that integration.
 */
const SUBJECT_OF = {
  client_secret: "integration",
  registration_access_token: "integration",
  code_verifier: "attempt",
  access_token: "connection",
  refresh_token: "connection",
} as const satisfies Record<CredentialPurpose, CredentialSubject>;

@Injectable()
export class CredentialCipherService {
  readonly keyVersion = KEY_VERSION;

  private readonly key: Uint8Array;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfig, true>) {
    const secret = config.get("auth.secret", { infer: true });
    this.key = deriveSha256Key(Buffer.from(secret, "base64"), KEY_LABEL);
  }

  /**
   * Encrypts one credential for one integration and one purpose.
   *
   * Guard: the audience names the row *and* the purpose, and `jwtDecrypt`
   * refuses a mismatch. Binding to the row alone would leave the credentials of
   * one row carrying identical headers, so a ciphertext moved between the
   * columns would decrypt — and this platform would present the registration
   * management token to a token endpoint as a client secret.
   *
   * Guard: no expiry is set. A client secret's lifetime is
   * `clientSecretExpiresAt`, and a JWE `exp` would make a still-valid credential
   * undecryptable on a clock this platform does not control.
   *
   * @param subjectId the row the credential belongs to
   * @param purpose which credential of that row this is
   * @param value the credential as the authorization server issued it
   * @returns a compact JWE
   */
  async seal(
    subjectId: string,
    purpose: CredentialPurpose,
    value: string,
  ): Promise<string> {
    return new EncryptJWT({ credential: value })
      .setProtectedHeader({
        alg: "dir",
        enc: "A256GCM",
        kid: `v${KEY_VERSION}`,
      })
      .setIssuer(ISSUER)
      .setAudience(audienceFor(subjectId, purpose))
      .setIssuedAt()
      .encrypt(this.key);
  }

  /**
   * @param subjectId the row the ciphertext was read from
   * @param purpose the column it was read from
   * @param sealed the stored compact JWE
   * @returns the credential, or `undefined` when it does not belong here
   */
  async open(
    subjectId: string,
    purpose: CredentialPurpose,
    sealed: string,
  ): Promise<string | undefined> {
    try {
      const { payload, protectedHeader } = await jwtDecrypt(sealed, this.key, {
        issuer: ISSUER,
        audience: audienceFor(subjectId, purpose),
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
      });

      if (protectedHeader.kid !== `v${KEY_VERSION}`) {
        return undefined;
      }

      const { credential } = payload;

      return typeof credential === "string" ? credential : undefined;
    } catch {
      return undefined;
    }
  }
}

function audienceFor(subjectId: string, purpose: CredentialPurpose): string {
  return `chat:${SUBJECT_OF[purpose]}:${subjectId}:${purpose}`;
}
