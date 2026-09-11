import type { HealthResponse } from "@chat/contracts/http/health";
import { Controller, Get, Req } from "@nestjs/common";

import { I18nService } from "../i18n/i18n.service.ts";
import type { RequestWithLocale } from "../i18n/request-locale.ts";
import { LlmService } from "../llm/llm.service.ts";
import { ReaderSessionService } from "../mcp/reader-session.service.ts";

@Controller("health")
export class HealthController {
  constructor(
    private readonly llm: LlmService,
    private readonly readers: ReaderSessionService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  async check(@Req() request: RequestWithLocale): Promise<HealthResponse> {
    const [llm, workbook, document] = await Promise.all([
      this.llm.probe(),
      this.readers.probe("workbook"),
      this.readers.probe("document"),
    ]);

    return {
      status: "ok",
      locale: request.locale ?? this.i18n.defaultLocale,
      uptimeSeconds: Math.round(process.uptime()),
      llm,
      readers: { workbook, document },
    };
  }
}
