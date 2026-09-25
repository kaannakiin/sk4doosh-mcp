import {
  agentApprovalAnswerSchema,
  agentApprovalParamsSchema,
  type AgentApprovalAnswer,
  type AgentApprovalParams,
} from "@chat/contracts/agent/approval";
import type { ApiError } from "@chat/contracts/http/error";
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard.ts";
import { AuthOriginGuard } from "../auth/auth-origin.guard.ts";
import { requireAuth, type RequestWithAuth } from "../auth/request-auth.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import { ApprovalHolds } from "./approval-holds.ts";

@Controller("agent/approvals")
@UseGuards(AuthOriginGuard, AuthGuard)
export class GatewayController {
  constructor(
    private readonly holds: ApprovalHolds,
    private readonly i18n: I18nService,
  ) {}

  @Post(":approvalId")
  @HttpCode(HttpStatus.NO_CONTENT)
  answer(
    @Param({ schema: agentApprovalParamsSchema }) params: AgentApprovalParams,
    @Body({ schema: agentApprovalAnswerSchema }) body: AgentApprovalAnswer,
    @Req() request: RequestWithAuth,
  ): void {
    const settled = this.holds.answer(
      requireAuth(request).user.internalId,
      params.approvalId,
      body,
    );

    if (!settled) {
      throw new HttpException(
        {
          code: "approval_not_found",
          message: this.i18n.t("chat:gateway.approval_not_found"),
        } satisfies ApiError,
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
