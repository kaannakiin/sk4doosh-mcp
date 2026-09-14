import { Global, Module } from "@nestjs/common";

import { RateLimitTrackerService } from "./rate-limit-tracker.service.ts";
import { RedisThrottlerStorage } from "./redis-throttler.storage.ts";
import { RedisService } from "./redis.service.ts";

@Global()
@Module({
  providers: [RedisService, RedisThrottlerStorage, RateLimitTrackerService],
  exports: [RedisService, RedisThrottlerStorage, RateLimitTrackerService],
})
export class RedisModule {}
