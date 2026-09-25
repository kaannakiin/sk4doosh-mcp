import {
  agentCatalogQuerySchema,
  agentSelectionSchema,
  type AgentCatalogQuery,
  type AgentCatalogResponse,
  type AgentSelection,
} from "@chat/contracts/agent/model";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";

import { AuthGuard } from "../auth/auth.guard.ts";
import { AuthOriginGuard } from "../auth/auth-origin.guard.ts";
import { requireAuth, type RequestWithAuth } from "../auth/request-auth.ts";
import type { UserId } from "../db/ids.ts";
import { AgentSelectionRepository } from "./agent-selection.repository.ts";
import { ModelCatalogService } from "./model-catalog.service.ts";

@Controller("agent")
@UseGuards(AuthOriginGuard, AuthGuard)
export class AgentController {
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly selections: AgentSelectionRepository,
  ) {}

  @Get("catalog")
  async catalogOf(
    @Query({ schema: agentCatalogQuerySchema }) query: AgentCatalogQuery,
    @Req() request: RequestWithAuth,
  ): Promise<AgentCatalogResponse> {
    return this.catalog.catalogFor(this.userIdOf(request), query.sessionId);
  }

  @Put("selection")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setDefault(
    @Body({ schema: agentSelectionSchema }) body: AgentSelection,
    @Req() request: RequestWithAuth,
  ): Promise<void> {
    await this.selections.setForUser(this.userIdOf(request), body);
  }

  private userIdOf(request: RequestWithAuth): UserId {
    return requireAuth(request).user.internalId;
  }
}
