import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_PIPE } from "@nestjs/core";

import { ChatModule } from "./chat/chat.module.ts";
import { loadConfig } from "./config/configuration.ts";
import { HealthModule } from "./health/health.module.ts";
import { I18nModule } from "./i18n/i18n.module.ts";
import { LocaleMiddleware } from "./i18n/locale.middleware.ts";
import { ZodValidationPipe } from "./pipes/zod-validation.pipe.ts";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ".env",
      load: [loadConfig],
    }),
    I18nModule,
    HealthModule,
    ChatModule,
  ],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LocaleMiddleware).forRoutes("{*path}");
  }
}
