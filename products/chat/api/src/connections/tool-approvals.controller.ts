import type { ApiError } from "@chat/contracts/http/error";
import {
  rememberToolSchema,
  toolApprovalParamsSchema,
  updateGrantTtlSchema,
  updateToolApprovalModeSchema,
  type ApprovedToolListResponse,
  type RememberTool,
  type ToolApprovalParams,
  type UpdateGrantTtl,
  type UpdateToolApprovalMode,
} from "@chat/contracts/integration/tool-approval";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

import { AuthGuard } from "../auth/auth.guard.ts";
import { AuthOriginGuard } from "../auth/auth-origin.guard.ts";
import { NoStoreInterceptor } from "../auth/no-store.interceptor.ts";
import { requireAuth, type RequestWithAuth } from "../auth/request-auth.ts";
import type { UserId } from "../db/ids.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import {
  scopeKeyFor,
  ToolApprovalRepository,
} from "./tool-approval.repository.ts";
import { ToolApprovalService } from "./tool-approval.service.ts";

/**
 * Guard: its own controller rather than a route under `/integrations`. The path
 * there is `/integrations/:integrationId/...`, and a literal segment beside a
 * parameter is decided by declaration order — a rename or a reorder would make
 * `tool-approvals` resolve as an integration id.
 *
 * Guard: the controller's default rate limit, not the registration one. That
 * limit protects endpoints which open a connection to an address the caller
 * chose; these open none, and five approvals per fifteen minutes would make a
 * conversation unusable.
 */
@Controller("tool-approvals")
@UseGuards(ThrottlerGuard, AuthOriginGuard, AuthGuard)
@UseInterceptors(NoStoreInterceptor)
export class ToolApprovalsController {
  constructor(
    private readonly approvals: ToolApprovalService,
    private readonly modes: ToolApprovalRepository,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Guard: declared before `:exposedName`, which Nest would otherwise match
   * against the literal segment. Nothing this platform mints is named `mode` —
   * every exposed name begins with a derived prefix — but the route order is
   * what makes that a fact rather than a coincidence.
   *
   * Guard: this lives here and not on the auth controller. `ConnectionsModule`
   * already imports `AuthModule`, so the reverse would be a cycle; the mode is
   * read back through `/auth/me`, which needs no module dependency at all.
   */
  /**
   * Guard: declared before `:exposedName` for the same reason `mode` is. Nothing
   * this platform mints is named by a bare verb, but route order is what makes
   * that a fact rather than a coincidence.
   */
  @Get()
  async list(
    @Req() request: RequestWithAuth,
  ): Promise<ApprovedToolListResponse> {
    const approvals = await this.approvals.listChatTools(
      this.userIdOf(request),
    );

    return { approvals: [...approvals] };
  }

  @Patch("ttl")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setTtl(
    @Body({ schema: updateGrantTtlSchema }) body: UpdateGrantTtl,
    @Req() request: RequestWithAuth,
  ): Promise<void> {
    await this.modes.setTtl(this.userIdOf(request), body.ttl);
  }

  @Patch("mode")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setMode(
    @Body({ schema: updateToolApprovalModeSchema })
    body: UpdateToolApprovalMode,
    @Req() request: RequestWithAuth,
  ): Promise<void> {
    await this.modes.setMode(this.userIdOf(request), body.mode);
  }

  /**
   * Guard: `PUT`, and the body names only the scope. Remembering the same tool
   * twice is not an error, and the digest is read from the stored definition
   * rather than sent — a client-supplied digest would be a client-supplied
   * grant. The expiry is computed here from the reader's own preference for the
   * same reason.
   */
  @Put(":exposedName")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remember(
    @Param({ schema: toolApprovalParamsSchema }) params: ToolApprovalParams,
    @Body({ schema: rememberToolSchema }) body: RememberTool,
    @Req() request: RequestWithAuth,
  ): Promise<void> {
    await this.settle(
      await this.approvals.remember(
        this.userIdOf(request),
        params.exposedName,
        scopeKeyFor(body.scope, body.sessionId),
      ),
    );
  }

  @Delete(":exposedName")
  @HttpCode(HttpStatus.NO_CONTENT)
  async forget(
    @Param({ schema: toolApprovalParamsSchema }) params: ToolApprovalParams,
    @Req() request: RequestWithAuth,
  ): Promise<void> {
    await this.settle(
      await this.approvals.forget(this.userIdOf(request), params.exposedName),
    );
  }

  private async settle(outcome: "changed" | "unknown_tool"): Promise<void> {
    if (outcome === "unknown_tool") {
      throw new HttpException(
        {
          code: "tool_not_offered",
          message: this.i18n.t("connections:errors.tool_not_offered"),
        } satisfies ApiError,
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private userIdOf(request: RequestWithAuth): UserId {
    return requireAuth(request).user.internalId;
  }
}
