import type { ApiError } from "@chat/contracts/http/error";
import {
  connectParamsSchema,
  type ConnectParams,
} from "@chat/contracts/integration/connect";
import type { ApprovedToolListResponse } from "@chat/contracts/integration/tool-approval";
import {
  createIntegrationSchema,
  type CreateIntegration,
  type IntegrationListResponse,
  type IntegrationSummary,
} from "@chat/contracts/integration/registration";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";

import { AuthGuard } from "../auth/auth.guard.ts";
import { AuthOriginGuard } from "../auth/auth-origin.guard.ts";
import { NoStoreInterceptor } from "../auth/no-store.interceptor.ts";
import { requireAuth, type RequestWithAuth } from "../auth/request-auth.ts";
import type { UserId } from "../db/ids.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import { ConnectionRevocationService } from "./connection-revocation.service.ts";
import { IntegrationRepository } from "./integration.repository.ts";
import { IntegrationRegistrationService } from "./integration-registration.service.ts";
import { IntegrationToolsService } from "./integration-tools.service.ts";
import { ToolApprovalService } from "./tool-approval.service.ts";

/**
 * Guard: registering is rate limited far below the rest of this controller
 * because one request makes this process open three connections to an address
 * the caller chose. `guarded-http.ts` decides which addresses are reachable;
 * nothing but this limit decides how often a signed-in reader may ask.
 */
const REGISTER_THROTTLE = {
  network: { limit: 20, ttl: 15 * 60 * 1000 },
  subject: { limit: 5, ttl: 15 * 60 * 1000 },
};

@Controller("integrations")
@UseGuards(ThrottlerGuard, AuthOriginGuard, AuthGuard)
@UseInterceptors(NoStoreInterceptor)
export class IntegrationsController {
  constructor(
    private readonly registration: IntegrationRegistrationService,
    private readonly revocation: ConnectionRevocationService,
    private readonly integrations: IntegrationRepository,
    private readonly tools: IntegrationToolsService,
    private readonly toolApprovals: ToolApprovalService,
    private readonly i18n: I18nService,
  ) {}

  @Post()
  @Throttle(REGISTER_THROTTLE)
  async register(
    @Body({ schema: createIntegrationSchema }) body: CreateIntegration,
    @Req() request: RequestWithAuth,
  ): Promise<IntegrationSummary> {
    const outcome = await this.registration.register(this.userIdOf(request), body);

    if (outcome.kind === "refused") {
      throw this.fail(outcome.failure, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    return outcome.integration;
  }

  @Get()
  async list(
    @Req() request: RequestWithAuth,
  ): Promise<IntegrationListResponse> {
    return {
      integrations: [
        ...(await this.integrations.listFor(this.userIdOf(request))),
      ],
    };
  }

  /**
   * Guard: rate limited like registering, not like reading. One request makes
   * this process talk to an address the caller chose, and on an open server that
   * has started refusing it also runs discovery and a client registration.
   */
  @Post(":integrationId/tools")
  @Throttle(REGISTER_THROTTLE)
  async refreshTools(
    @Param({ schema: connectParamsSchema }) params: ConnectParams,
    @Req() request: RequestWithAuth,
  ): Promise<IntegrationListResponse> {
    const userId = this.userIdOf(request);
    const outcome = await this.tools.refresh(userId, params.integrationId);

    if (outcome.kind === "not_found") {
      throw this.fail("integration_not_found", HttpStatus.NOT_FOUND);
    }

    if (outcome.kind === "provider_unavailable") {
      throw this.fail("integration_unreachable", HttpStatus.BAD_GATEWAY);
    }

    return { integrations: [...(await this.integrations.listFor(userId))] };
  }

  @Get(":integrationId/approvals")
  async approvals(
    @Param({ schema: connectParamsSchema }) params: ConnectParams,
    @Req() request: RequestWithAuth,
  ): Promise<ApprovedToolListResponse> {
    const approvals = await this.toolApprovals.listFor(
      this.userIdOf(request),
      params.integrationId,
    );

    if (approvals === undefined) {
      throw this.fail("integration_not_found", HttpStatus.NOT_FOUND);
    }

    return { approvals: [...approvals] };
  }

  /**
   * Guard: the connection is withdrawn before the row goes. Deleting the
   * integration cascades the connection away, and a grant this platform still
   * held a token for would then survive at the provider with nothing left here
   * to revoke it with.
   */
  @Delete(":integrationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param({ schema: connectParamsSchema }) params: ConnectParams,
    @Req() request: RequestWithAuth,
  ): Promise<void> {
    const userId = this.userIdOf(request);
    await this.revocation.disconnect(userId, params.integrationId);

    if (!(await this.integrations.removeOwned(userId, params.integrationId))) {
      throw this.fail("integration_not_found", HttpStatus.NOT_FOUND);
    }
  }

  @Delete(":integrationId/connection")
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(
    @Param({ schema: connectParamsSchema }) params: ConnectParams,
    @Req() request: RequestWithAuth,
  ): Promise<void> {
    const outcome = await this.revocation.disconnect(
      this.userIdOf(request),
      params.integrationId,
    );

    if (outcome === "unknown_integration") {
      throw this.fail("integration_not_found", HttpStatus.NOT_FOUND);
    }
  }

  private userIdOf(request: RequestWithAuth): UserId {
    return requireAuth(request).user.internalId;
  }

  private fail(code: string, status: HttpStatus): HttpException {
    const body: ApiError = {
      code,
      message: this.i18n.t(`connections:errors.${code}`),
    };

    return new HttpException(body, status);
  }
}
