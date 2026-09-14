import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ThrottlerStorage } from "@nestjs/throttler";

import type { AppConfig } from "../config/configuration.ts";
import { RedisService } from "./redis.service.ts";

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage["increment"]>
>;

const INCREMENT_SCRIPT = `
local block_ttl = redis.call("PTTL", KEYS[2])
if block_ttl > 0 then
  local hits = tonumber(redis.call("GET", KEYS[1]) or "0")
  local hit_ttl = math.max(redis.call("PTTL", KEYS[1]), 0)
  return {hits, math.ceil(hit_ttl / 1000), 1, math.ceil(block_ttl / 1000)}
end

local hits = redis.call("INCR", KEYS[1])
if hits == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end

local hit_ttl = math.max(redis.call("PTTL", KEYS[1]), 0)
if hits > tonumber(ARGV[2]) then
  redis.call("SET", KEYS[2], "1", "PX", ARGV[3])
  redis.call("PEXPIRE", KEYS[1], ARGV[3])
  local block_seconds = math.ceil(tonumber(ARGV[3]) / 1000)
  return {hits, block_seconds, 1, block_seconds}
end

return {hits, math.ceil(hit_ttl / 1000), 0, 0}
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly prefix: string;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConfigService) config: ConfigService<AppConfig, true>,
  ) {
    this.prefix = config.get("redis.keyPrefix", { infer: true });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}:rate-limit:{${key}}:${throttlerName}`;
    const result = await this.redis.eval(
      INCREMENT_SCRIPT,
      [`${base}:hits`, `${base}:block`],
      [String(ttl), String(limit), String(blockDuration)],
    );
    if (!Array.isArray(result) || result.length !== 4) {
      throw new Error("Redis returned an invalid throttler result");
    }

    return {
      totalHits: numericReply(result[0]),
      timeToExpire: numericReply(result[1]),
      isBlocked: numericReply(result[2]) === 1,
      timeToBlockExpire: numericReply(result[3]),
    };
  }
}

function numericReply(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }

  throw new Error("Redis returned a non-numeric throttler value");
}
