import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/client.js";

export type Db = PrismaClient;

export interface DbOptions {
  readonly connectionString: string;
  readonly poolMax: number;
}

/**
 * Opens the pool this process uses for the whole of its lifetime.
 *
 * @param options connection string and pool ceiling, both from validated config
 * @returns a client the caller owns and must `$disconnect` on shutdown
 */
export function createDb(options: DbOptions): Db {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: options.connectionString,
      max: options.poolMax,
    }),
  });
}
