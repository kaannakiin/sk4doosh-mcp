import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.ts";
import { AppServerService } from "../codex/app-server/app-server.service.ts";
import { DbModule } from "../db/db.module.ts";
import { AgentSelectionRepository } from "./agent-selection.repository.ts";
import { AgentController } from "./agent.controller.ts";
import { ModelCatalogService } from "./model-catalog.service.ts";

@Module({
  imports: [AuthModule, DbModule],
  controllers: [AgentController],
  providers: [AppServerService, AgentSelectionRepository, ModelCatalogService],
  exports: [AppServerService, AgentSelectionRepository, ModelCatalogService],
})
export class AgentModule {}
