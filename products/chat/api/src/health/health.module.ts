import { Module } from "@nestjs/common";

import { AttachmentsModule } from "../attachments/attachments.module.ts";
import { CodexModule } from "../codex/codex.module.ts";
import { DbModule } from "../db/db.module.ts";
import { LlmModule } from "../llm/llm.module.ts";
import { McpModule } from "../mcp/mcp.module.ts";
import { HealthController } from "./health.controller.ts";

@Module({
  imports: [AttachmentsModule, CodexModule, DbModule, LlmModule, McpModule],
  controllers: [HealthController],
})
export class HealthModule {}
