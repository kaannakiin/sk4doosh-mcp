import type { Db } from "./client.js";
import type { OwnerRow } from "./rows.js";

/**
 * Guard: the surrogate crosses this boundary as a decimal string, never as the
 * `bigint` the column actually holds. Prisma maps `BigInt` to a JavaScript
 * `bigint` and `JSON.stringify` throws on one, so a surrogate that reached a
 * response body would turn a successful query into a 500. Converting at the seam
 * costs one parse per call and makes the hazard unrepresentable upstream.
 */
function toRow(row: {
  id: bigint;
  createdAt: Date;
  lastSeenAt: Date;
}): OwnerRow {
  return {
    id: row.id.toString(),
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * Finds the owner a cookie names, refreshing its last-seen stamp.
 *
 * @param tokenHash sha256 of the opaque cookie value, never the value itself
 * @returns the owner, or `undefined` when the cookie names nobody
 */
export async function resolveOwner(
  db: Db,
  tokenHash: Uint8Array,
): Promise<OwnerRow | undefined> {
  const found = await db.chatOwner.findUnique({
    where: { tokenHash: Buffer.from(tokenHash) },
  });

  if (found === null) {
    return undefined;
  }

  return toRow(
    await db.chatOwner.update({
      where: { id: found.id },
      data: { lastSeenAt: new Date() },
    }),
  );
}

/**
 * Records a newly minted cookie.
 *
 * @param tokenHash sha256 of the opaque cookie value
 */
export async function createOwner(
  db: Db,
  tokenHash: Uint8Array,
): Promise<OwnerRow> {
  return toRow(
    await db.chatOwner.create({ data: { tokenHash: Buffer.from(tokenHash) } }),
  );
}
