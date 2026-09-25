import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";

import { sha256Bytes } from "../common/utils/crypto.utils.ts";
import type { GatewayTurn } from "./gateway-turn.ts";

function keyOf(token: string): string {
  return sha256Bytes(token).toString("hex");
}

interface Grant {
  readonly turn: GatewayTurn;
  readonly expiresAt: number;
}

/**
 * The bearer grants the agent gateway accepts, one per running turn.
 *
 * Guard: a grant lives exactly as long as its turn. Measured on codex 0.154: a
 * `thread/resume` of a thread the app-server still has loaded ignores the new
 * `config`, and keeps calling the gateway with the header it started with; only
 * `thread/unsubscribe` followed by `thread/resume` applies a new one. The turn
 * service does that before every turn, so each turn brings a fresh grant and a
 * grant outliving its turn would only be a credential nobody should still hold.
 *
 * Guard: the map is keyed by the token's digest, never the token itself, so the
 * value that authorizes a call is held nowhere in this process after `open`
 * returns it.
 */
@Injectable()
export class GrantRegistry {
  private readonly grants = new Map<string, Grant>();

  /**
   * @param turn what the grant resolves to
   * @param expiresAt epoch milliseconds past which the grant is refused even if
   *   its turn never closed it
   * @returns the bearer token, which this registry does not keep
   */
  open(turn: GatewayTurn, expiresAt: number): string {
    const token = randomBytes(32).toString("base64url");
    this.grants.set(keyOf(token), { turn, expiresAt });

    return token;
  }

  close(token: string): void {
    this.grants.delete(keyOf(token));
  }

  grantFor(token: string): Grant | undefined {
    const grant = this.grants.get(keyOf(token));
    if (grant !== undefined && grant.expiresAt <= Date.now()) {
      this.grants.delete(keyOf(token));

      return undefined;
    }

    return grant;
  }

  turnFor(token: string): GatewayTurn | undefined {
    return this.grantFor(token)?.turn;
  }
}
