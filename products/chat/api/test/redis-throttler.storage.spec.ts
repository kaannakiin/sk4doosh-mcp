import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { RedisThrottlerStorage } from "../src/redis/redis-throttler.storage.ts";
import { RedisService } from "../src/redis/redis.service.ts";

class FakeRedisService {
  result: unknown = [6, 900, 1, 900];
  keys: readonly string[] = [];
  args: readonly string[] = [];

  eval(
    _script: string,
    keys: readonly string[],
    args: readonly string[],
  ): Promise<unknown> {
    this.keys = keys;
    this.args = args;

    return Promise.resolve(this.result);
  }
}

async function createStorage(fake: FakeRedisService) {
  const module = await Test.createTestingModule({
    providers: [
      RedisThrottlerStorage,
      { provide: RedisService, useValue: fake },
      {
        provide: ConfigService,
        useValue: {
          get: (path: string) =>
            path === "redis.keyPrefix" ? "chat" : undefined,
        },
      },
    ],
  }).compile();

  return module.get(RedisThrottlerStorage);
}

describe("RedisThrottlerStorage", () => {
  it("maps the atomic Redis result to Nest throttler semantics", async () => {
    const fake = new FakeRedisService();
    const storage = await createStorage(fake);

    await expect(
      storage.increment("hashed-tracker", 900_000, 5, 900_000, "subject"),
    ).resolves.toEqual({
      totalHits: 6,
      timeToExpire: 900,
      isBlocked: true,
      timeToBlockExpire: 900,
    });
    expect(fake.keys).toEqual([
      "chat:rate-limit:{hashed-tracker}:subject:hits",
      "chat:rate-limit:{hashed-tracker}:subject:block",
    ]);
    expect(fake.args).toEqual(["900000", "5", "900000"]);
  });

  it("rejects malformed Redis replies", async () => {
    const fake = new FakeRedisService();
    fake.result = ["not-a-number"];
    const storage = await createStorage(fake);

    await expect(
      storage.increment("hashed-tracker", 1_000, 5, 1_000, "network"),
    ).rejects.toThrow("invalid throttler result");
  });
});
