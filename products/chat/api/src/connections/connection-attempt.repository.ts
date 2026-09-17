import { Injectable } from "@nestjs/common";

import { DbService } from "../db/db.service.ts";

export interface AttemptSnapshot {
  readonly userId: bigint;
  readonly integrationId: bigint;
  readonly stateHash: Uint8Array;
  readonly sealedCodeVerifier: string;
  readonly keyVersion: number;
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly scope: string | undefined;
  readonly expiresAt: Date;
}

export interface ConsumedAttempt {
  readonly userId: bigint;
  readonly integrationId: bigint;
  readonly integrationPublicId: string;
  readonly sealedCodeVerifier: string;
  readonly issuer: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly scope: string | undefined;
}

@Injectable()
export class ConnectionAttemptRepository {
  constructor(private readonly db: DbService) {}

  async open(snapshot: AttemptSnapshot): Promise<void> {
    await this.db.client.connectionAttempt.create({
      data: {
        userId: snapshot.userId,
        integrationId: snapshot.integrationId,
        stateHash: Buffer.from(snapshot.stateHash),
        codeVerifier: snapshot.sealedCodeVerifier,
        keyVersion: snapshot.keyVersion,
        issuer: snapshot.issuer,
        tokenEndpoint: snapshot.tokenEndpoint,
        clientId: snapshot.clientId,
        redirectUri: snapshot.redirectUri,
        resource: snapshot.resource,
        scope: snapshot.scope ?? null,
        expiresAt: snapshot.expiresAt,
      },
    });
  }

  /**
   * Claims an attempt, exactly once.
   *
   * Guard: the claim is an `updateMany` filtered on `consumedAt: null`, so two
   * callbacks arriving with one state produce one winner and one `undefined`.
   * An authorization code is visible in the browser's history and in a referrer;
   * replaying it against a still-open attempt would mint a second token for the
   * same grant.
   *
   * Guard: expiry is part of the same filter rather than a later comparison.
   * Reading the row first and checking afterwards leaves the window where both
   * callers read an unexpired row.
   *
   * @param stateHash the digest of the state the callback carried
   * @returns the snapshot taken when the browser was sent away, or `undefined`
   */
  async consume(stateHash: Uint8Array): Promise<ConsumedAttempt | undefined> {
    return this.db.client.$transaction(async (tx) => {
      const { count } = await tx.connectionAttempt.updateMany({
        where: {
          stateHash: Buffer.from(stateHash),
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });

      if (count !== 1) {
        return undefined;
      }

      const row = await tx.connectionAttempt.findUniqueOrThrow({
        where: { stateHash: Buffer.from(stateHash) },
        omit: { codeVerifier: false },
      });
      const integration = await tx.integration.findUniqueOrThrow({
        where: { id: row.integrationId },
        select: { publicId: true },
      });

      return {
        userId: row.userId,
        integrationId: row.integrationId,
        integrationPublicId: integration.publicId,
        sealedCodeVerifier: row.codeVerifier,
        issuer: row.issuer,
        tokenEndpoint: row.tokenEndpoint,
        clientId: row.clientId,
        redirectUri: row.redirectUri,
        resource: row.resource,
        scope: row.scope ?? undefined,
      };
    });
  }
}
