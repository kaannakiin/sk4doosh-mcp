import type { Readiness } from "@chat/contracts/http/health";
import { createDb, type Db } from "@chat/db";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";

@Injectable()
export class DbService implements OnModuleDestroy {
  /**
   * Guard: every query goes through a function `@chat/db` exports, never through
   * this client's model delegates. Those delegates return the tables' `bigint`
   * surrogates, and `JSON.stringify` throws on a `bigint` — the row mappers in
   * `@chat/db` are the only place that converts them, so reaching past them puts
   * a value in scope that turns a successful query into a 500.
   */
  readonly client: Db;

  constructor(config: ConfigService<AppConfig, true>) {
    const database = config.get("database", { infer: true });
    this.client = createDb({
      connectionString: database.url,
      poolMax: database.poolMax,
    });
  }

  /**
   * Reports whether the database answers and carries this product's schema.
   *
   * @returns `ready` when a migration has been applied, `failed` otherwise
   */
  async probe(): Promise<Readiness> {
    try {
      const [row] = await this.client.$queryRaw<{ present: boolean }[]>`
        select to_regclass('chat_message') is not null as present
      `;

      return row?.present === true ? "ready" : "unconfigured";
    } catch {
      return "failed";
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
