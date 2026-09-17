import { createHmac } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { deriveSha256Key } from "../common/utils/crypto.utils.ts";
import { property, stringProperty } from "../common/utils/object.utils.ts";
import { normalizeBoundedString } from "../common/utils/string.utils.ts";
import type { AppConfig } from "../config/configuration.ts";

const MAX_TRACKER_INPUT_LENGTH = 4_096;

@Injectable()
export class RateLimitTrackerService {
  private readonly key: Buffer;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfig, true>) {
    const secret = config.get("auth.secret", { infer: true });
    this.key = deriveSha256Key(
      Buffer.from(secret, "base64"),
      "chat-rate-limit-tracker",
    );
  }

  network(request: unknown): string {
    const ip =
      stringProperty(request, "ip") ??
      stringProperty(property(request, "socket"), "remoteAddress") ??
      "unknown";

    return this.fingerprint("network", ip);
  }

  subject(request: unknown): string | undefined {
    const body = property(request, "body");
    const email = normalizeBoundedString(
      stringProperty(body, "email"),
      MAX_TRACKER_INPUT_LENGTH,
      (value) => value.trim().toLowerCase(),
    );
    if (email !== undefined) {
      return this.fingerprint("email", email);
    }
    const phone = normalizeBoundedString(
      stringProperty(body, "phoneE164"),
      MAX_TRACKER_INPUT_LENGTH,
      (value) => value.trim(),
    );
    if (phone !== undefined) {
      return this.fingerprint("phone", phone);
    }
    const challengeId = normalizeBoundedString(
      stringProperty(body, "challengeId"),
      MAX_TRACKER_INPUT_LENGTH,
      (value) => value.trim().toLowerCase(),
    );
    if (challengeId !== undefined) {
      return this.fingerprint("challenge", challengeId);
    }

    const cookies = property(request, "cookies");
    for (const [kind, name] of [
      ["refresh", "chat_refresh"],
      ["oauth-pending", "chat_oauth_pending"],
      ["oauth-state", "chat_oauth"],
    ] as const) {
      const value = normalizeBoundedString(
        stringProperty(cookies, name),
        MAX_TRACKER_INPUT_LENGTH,
        (raw) => raw,
      );
      if (value !== undefined) {
        return this.fingerprint(kind, value);
      }
    }

    return undefined;
  }

  private fingerprint(kind: string, value: string): string {
    const digest = createHmac("sha256", this.key)
      .update(value)
      .digest("base64url");

    return `${kind}:${digest}`;
  }
}
