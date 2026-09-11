import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";

import { AttachmentsModule } from "../attachments/attachments.module.ts";
import type { AppConfig } from "../config/configuration.ts";
import { LlmModule } from "../llm/llm.module.ts";
import { McpModule } from "../mcp/mcp.module.ts";
import { ChatController } from "./chat.controller.ts";
import { ChatService } from "./chat.service.ts";

@Module({
  imports: [
    AttachmentsModule,
    LlmModule,
    McpModule,
    /**
     * Guard: the byte ceiling belongs on multer, not on a validator that runs
     * after the fact. Multer aborts the request mid-stream and Nest maps that
     * to a 413, so an oversized upload is never buffered whole in memory.
     */
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        limits: {
          fileSize: config.get("uploads", { infer: true }).maxBytes,
          files: 1,
        },
      }),
    }),
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
