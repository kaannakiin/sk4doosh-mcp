import type { IntegrationId } from "@chat/contracts/integration/integration";
import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";
import type { UserId } from "../db/ids.ts";
import {
  toInvocationContext,
  type InvocationContext,
} from "./connection-rows.ts";

@Injectable()
export class ConnectionRepository {
  constructor(private readonly db: DbService) {}

  /**
   * Everything an invocation decision needs, in one read.
   *
   * Guard: a `user` origin integration belongs to one person, so the query
   * refuses to resolve someone else's by its public id. Without the filter a
   * caller naming an id they do not own would learn that the integration exists,
   * which is the whole of what a private server's registration discloses.
   *
   * Guard: the connection is selected by owner here rather than by an id the
   * caller supplies, so there is no identifier a caller could name to reach
   * another user's connection.
   *
   * @param userId the subject of the trusted session, never a value the model produced
   * @param integrationId the integration the requested tool was resolved from
   * @returns the decision input, or `undefined` when no integration is visible
   * to this user under that id
   */
  async loadInvocationContext(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<InvocationContext | undefined> {
    const owner = BigInt(userId);
    const found = await this.db.client.integration.findFirst({
      where: {
        publicId: integrationId,
        status: "active",
        OR: [{ origin: "partner" }, { ownerId: owner }],
      },
      include: {
        toolScopes: true,
        connections: { where: { userId: owner }, include: { scopes: true } },
      },
    });

    return found === null ? undefined : toInvocationContext(found);
  }
}
