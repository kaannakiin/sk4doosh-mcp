import { DEFAULT_LOCALE } from "@chat/contracts/common/locale";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Response } from "express";

import type { AppConfig } from "../config/configuration.ts";
import { runWithLocale } from "./locale.store.ts";
import type { RequestWithLocale } from "./request-locale.ts";
import { resolveLocale } from "./resolve-locale.ts";

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  return Array.isArray(value) && typeof value[0] === "string"
    ? value[0]
    : undefined;
}

@Injectable()
export class LocaleMiddleware implements NestMiddleware {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  use(
    request: RequestWithLocale,
    _response: Response,
    next: NextFunction,
  ): void {
    const locale = resolveLocale(
      {
        query: firstString(request.query["lang"]),
        header: firstString(request.headers["x-locale"]),
        acceptLanguage: request.headers["accept-language"],
      },
      this.config.get("defaultLocale", { infer: true }) ?? DEFAULT_LOCALE,
    );

    request.locale = locale;
    runWithLocale(locale, next);
  }
}
