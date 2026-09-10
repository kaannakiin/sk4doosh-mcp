import { DEFAULT_LOCALE } from "@chat/contracts/common/locale";
import type { HealthResponse } from "@chat/contracts/http/health";
import { Controller, Get, Req } from "@nestjs/common";
import type { RequestWithLocale } from "../i18n/request-locale.ts";

@Controller("health")
export class HealthController {
  @Get()
  check(@Req() request: RequestWithLocale): HealthResponse {
    return {
      status: "ok",
      locale: request.locale ?? DEFAULT_LOCALE,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
