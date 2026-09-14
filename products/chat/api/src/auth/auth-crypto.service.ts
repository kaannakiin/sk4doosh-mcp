import {
  WEB_ACCESS_TTL_MS,
  WEB_SESSION_AUDIENCE,
  WEB_SESSION_ISSUER,
} from "@chat/contracts/auth/auth";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import {
  EncryptJWT,
  jwtDecrypt,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";

import {
  deriveSha256Key,
  sha256Bytes,
} from "../common/utils/crypto.utils.ts";
import type { AppConfig } from "../config/configuration.ts";

const OTP_SALT_BYTES = 16;
const OTP_DIGEST_BYTES = 32;

export interface AccessIdentity {
  readonly userPublicId: string;
  readonly sessionPublicId: string;
}

export interface RefreshMaterial {
  readonly token: string;
  readonly hash: Uint8Array;
}

export interface OtpMaterial {
  readonly code: string;
  readonly encodedHash: Uint8Array;
}

@Injectable()
export class AuthCryptoService {
  private readonly accessKey: Uint8Array;
  private readonly envelopeKey: Uint8Array;
  private readonly otpKey: Uint8Array;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfig, true>) {
    const auth = config.get("auth", { infer: true });
    const root = Buffer.from(auth.secret, "base64");
    this.accessKey = deriveSha256Key(root, "chat-access-jwt");
    this.envelopeKey = deriveSha256Key(root, "chat-auth-envelope");
    this.otpKey = deriveSha256Key(root, "chat-otp-hmac");
  }

  async signAccess(identity: AccessIdentity): Promise<string> {
    return new SignJWT({ sid: identity.sessionPublicId, typ: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(identity.userPublicId)
      .setIssuer(WEB_SESSION_ISSUER)
      .setAudience(WEB_SESSION_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${Math.ceil(WEB_ACCESS_TTL_MS / 1000)}s`)
      .sign(this.accessKey);
  }

  async verifyAccess(token: string): Promise<AccessIdentity | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, {
        issuer: WEB_SESSION_ISSUER,
        audience: WEB_SESSION_AUDIENCE,
        algorithms: ["HS256"],
      });
      return payload.typ === "access" &&
        typeof payload.sub === "string" &&
        typeof payload.sid === "string"
        ? {
            userPublicId: payload.sub,
            sessionPublicId: payload.sid,
          }
        : undefined;
    } catch {
      return undefined;
    }
  }

  async seal(
    audience: string,
    payload: JWTPayload,
    ttlMs: number,
  ): Promise<string> {
    return new EncryptJWT(payload)
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuer(WEB_SESSION_ISSUER)
      .setAudience(`${WEB_SESSION_AUDIENCE}:${audience}`)
      .setIssuedAt()
      .setExpirationTime(`${Math.ceil(ttlMs / 1000)}s`)
      .encrypt(this.envelopeKey);
  }

  async unseal(
    audience: string,
    token: string,
  ): Promise<JWTPayload | undefined> {
    try {
      const { payload } = await jwtDecrypt(token, this.envelopeKey, {
        issuer: WEB_SESSION_ISSUER,
        audience: `${WEB_SESSION_AUDIENCE}:${audience}`,
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
      });

      return payload;
    } catch {
      return undefined;
    }
  }

  createRefresh(): RefreshMaterial {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: this.hashRefresh(token) };
  }

  hashRefresh(token: string): Uint8Array {
    return sha256Bytes(token);
  }

  createOtp(): OtpMaterial {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const salt = randomBytes(OTP_SALT_BYTES);
    const digest = this.otpDigest(salt, code);

    return {
      code,
      encodedHash: Buffer.concat([salt, digest]),
    };
  }

  verifyOtp(encodedHash: Uint8Array, code: string): boolean {
    if (encodedHash.byteLength !== OTP_SALT_BYTES + OTP_DIGEST_BYTES) {
      return false;
    }
    const bytes = Buffer.from(encodedHash);
    const salt = bytes.subarray(0, OTP_SALT_BYTES);
    const expected = bytes.subarray(OTP_SALT_BYTES);
    const actual = this.otpDigest(salt, code);

    return timingSafeEqual(expected, actual);
  }

  private otpDigest(salt: Uint8Array, code: string): Buffer {
    return createHmac("sha256", this.otpKey)
      .update(salt)
      .update(code, "utf8")
      .digest();
  }

}
