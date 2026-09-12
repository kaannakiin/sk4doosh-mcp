import {
  OWNER_TOKEN_BYTES,
  ownerTokenSchema,
} from "@chat/contracts/chat/owner";
import { createOwner, resolveOwner } from "@chat/db";
import { Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

import { DbService } from "../db/db.service.ts";
import { asOwnerId, type OwnerId } from "./owner-id.ts";

export interface ResolvedOwner {
  readonly id: OwnerId;
  readonly issuedToken: string | undefined;
}

@Injectable()
export class OwnerService {
  constructor(private readonly db: DbService) {}

  /**
   * Resolves the owner a cookie names, minting one when it names nobody.
   *
   * @param cookie the raw cookie value, absent on a first visit
   * @returns the owner, and the token to set when a new one was minted
   */
  async resolve(cookie: string | undefined): Promise<ResolvedOwner> {
    const token = ownerTokenSchema.safeParse(cookie);
    if (token.success) {
      const found = await resolveOwner(this.db.client, hash(token.data));
      if (found !== undefined) {
        return { id: asOwnerId(found.id), issuedToken: undefined };
      }
    }

    const minted = randomBytes(OWNER_TOKEN_BYTES).toString("base64url");
    const created = await createOwner(this.db.client, hash(minted));

    return { id: asOwnerId(created.id), issuedToken: minted };
  }
}

/**
 * Guard: only the digest is stored. The cookie value is a bearer credential, so
 * a dump of `chat_owner` must not be replayable as a set of live sessions — the
 * same reason a password column holds a hash.
 */
function hash(token: string): Uint8Array {
  return createHash("sha256").update(token).digest();
}
