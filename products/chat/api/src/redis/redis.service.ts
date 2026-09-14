import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, type RedisClientType } from "redis";

import { errorName } from "../common/utils/error.utils.ts";
import type { AppConfig } from "../config/configuration.ts";

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 1_000;

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClientType;
  private readonly commandTimeoutMs: number;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfig, true>) {
    const redis = config.get("redis", { infer: true });
    this.commandTimeoutMs = redis.commandTimeoutMs;
    this.client = createClient({
      url: redis.url,
      commandsQueueMaxLength: 500,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: redis.connectTimeoutMs,
        reconnectStrategy: (attempts) =>
          attempts >= MAX_RECONNECT_ATTEMPTS
            ? new Error("Redis reconnect limit reached")
            : Math.min(50 * 2 ** attempts, MAX_RECONNECT_DELAY_MS),
      },
    });
    this.client.on("error", (error: unknown) => {
      this.logger.error(`Redis connection error (${errorName(error)})`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.run((client) => client.ping());
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  eval(script: string, keys: readonly string[], args: readonly string[]) {
    return this.run((client) =>
      client.eval(script, {
        keys: [...keys],
        arguments: [...args],
      }),
    );
  }

  private run<T>(command: (client: RedisClientType) => Promise<T>): Promise<T> {
    const client = this.client.withAbortSignal(
      AbortSignal.timeout(this.commandTimeoutMs),
    );

    return command(client);
  }
}
