import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";

import { DbModule } from "../db/db.module.ts";
import { I18nModule } from "../i18n/i18n.module.ts";
import { RateLimitTrackerService } from "../redis/rate-limit-tracker.service.ts";
import { RedisModule } from "../redis/redis.module.ts";
import { RedisThrottlerStorage } from "../redis/redis-throttler.storage.ts";
import { AuthCookieService } from "./auth-cookie.service.ts";
import { AuthCryptoService } from "./auth-crypto.service.ts";
import { AuthErrorsService } from "./auth-errors.service.ts";
import { AuthGuard } from "./auth.guard.ts";
import { AuthOriginGuard } from "./auth-origin.guard.ts";
import { AuthSessionService } from "./auth-session.service.ts";
import { AuthController } from "./auth.controller.ts";
import { AuthSessionRepository } from "./auth-session.repository.ts";
import { AuthRepository } from "./auth.repository.ts";
import { AuthService } from "./auth.service.ts";
import { OAuthRepository } from "./oauth.repository.ts";
import { NoStoreInterceptor } from "./no-store.interceptor.ts";
import {
  LoggingOtpDelivery,
  OTP_DELIVERY,
} from "./otp-delivery.ts";
import { OAuthService } from "./oauth.service.ts";
import { PasswordService } from "./password.service.ts";

@Module({
  imports: [
    DbModule,
    I18nModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisThrottlerStorage, RateLimitTrackerService],
      useFactory: (
        storage: RedisThrottlerStorage,
        trackers: RateLimitTrackerService,
      ) => ({
        storage,
        throttlers: [
          {
            name: "network",
            ttl: 15 * 60 * 1000,
            limit: 50,
            getTracker: (request) => trackers.network(request),
          },
          {
            name: "subject",
            ttl: 15 * 60 * 1000,
            limit: 5,
            skipIf: (context) =>
              trackers.subject(context.switchToHttp().getRequest<unknown>()) ===
              undefined,
            getTracker: (request) =>
              trackers.subject(request) ?? trackers.network(request),
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthRepository,
    AuthSessionRepository,
    OAuthRepository,
    AuthService,
    AuthSessionService,
    AuthCryptoService,
    PasswordService,
    OAuthService,
    AuthCookieService,
    AuthErrorsService,
    AuthGuard,
    AuthOriginGuard,
    NoStoreInterceptor,
    LoggingOtpDelivery,
    { provide: OTP_DELIVERY, useExisting: LoggingOtpDelivery },
  ],
  exports: [
    AuthCookieService,
    AuthErrorsService,
    AuthGuard,
    AuthOriginGuard,
    AuthSessionService,
  ],
})
export class AuthModule {}
