import { Module } from "@nestjs/common";

import { LlmModule } from "../llm/llm.module.ts";
import { McpModule } from "../mcp/mcp.module.ts";
import { HealthController } from "./health.controller.ts";

@Module({
  imports: [LlmModule, McpModule],
  controllers: [HealthController],
})
export class HealthModule {}
