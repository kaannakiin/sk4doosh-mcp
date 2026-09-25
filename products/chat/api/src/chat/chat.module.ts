import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MulterModule } from "@nestjs/platform-express";

import { AgentModule } from "../agent/agent.module.ts";
import { AgentTurnService } from "../agent/agent-turn.service.ts";
import { AttachmentsModule } from "../attachments/attachments.module.ts";
import { AuthModule } from "../auth/auth.module.ts";
import { CodexModule } from "../codex/codex.module.ts";
import { ConnectionsModule } from "../connections/connections.module.ts";
import type { AppConfig } from "../config/configuration.ts";
import { DbModule } from "../db/db.module.ts";
import { ApprovalHolds } from "../gateway/approval-holds.ts";
import { GatewayCallsService } from "../gateway/gateway-calls.service.ts";
import { GatewayServerService } from "../gateway/gateway-server.service.ts";
import { GatewayController } from "../gateway/gateway.controller.ts";
import { GrantRegistry } from "../gateway/grant-registry.ts";
import { AgentServerPool } from "../gateway/server-pool.ts";
import { ToolDirectoryService } from "../gateway/tool-directory.service.ts";
import { WorkerLanes } from "../gateway/worker-lane.ts";
import { LlmModule } from "../llm/llm.module.ts";
import { McpModule } from "../mcp/mcp.module.ts";
import { ChatController } from "./chat.controller.ts";
import { ChatHistoryService } from "./chat-history.service.ts";
import { ChatSessionRepository } from "./chat-session.repository.ts";
import { ChatService } from "./chat.service.ts";
import { ToolApprovalGateService } from "./tool-approval-gate.service.ts";
import { RemoteToolInvoker } from "./remote-tool-invoker.ts";
import { RemoteToolSetService } from "./remote-tool-set.service.ts";
import { MessageRepository } from "./message.repository.ts";
import { SystemPromptService } from "./system-prompt.service.ts";

@Module({
  imports: [
    AgentModule,
    AttachmentsModule,
    AuthModule,
    /**
     * Guard: the dependency runs this way and never the other. `McpModule` owns
     * the local readers and must not learn about connected servers — a chat
     * concern reaching into `connections/` is what keeps the invocation rules in
     * one place.
     */
    ConnectionsModule,
    CodexModule,
    DbModule,
    LlmModule,
    McpModule,
    /**
     * Guard: the byte ceiling belongs on multer, not on a validator that runs
     * after the fact. Multer aborts the request mid-stream and Nest maps that
     * to a 413, so an oversized upload is never buffered whole in memory. It is
     * the per-file ceiling: multer cannot know how much of the session budget is
     * left because that is a database read, so the budget is checked separately
     * inside the upload transaction.
     */
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        /**
         * Guard: multer defaults this to `latin1`, so a Turkish filename arrives
         * as mojibake — "Satış.csv" becomes "SatÄ±Å.csv", which then survives into
         * the stored name, the manifest the model reads and the download header.
         * Browsers send multipart filenames as utf-8, so this is a decoding bug,
         * not a policy choice.
         */
        defParamCharset: "utf8",
        limits: {
          fileSize: config.get("uploads", { infer: true }).maxFileBytes,
          files: 1,
          /**
           * Guard: `fields` and `parts` close a real gap, not a stylistic one.
           * With only `files` bounded a client can post ten thousand text fields
           * and multer buffers every one into memory before any handler runs.
           * `parts` is 2 rather than 1 because busboy counts a lone file part as
           * two — measured, not assumed: at 1 every upload is rejected before it
           * reaches the handler, and the symptom is an opaque 400.
           */
          fields: 0,
          parts: 2,
        },
      }),
    }),
  ],
  controllers: [ChatController, GatewayController],
  providers: [
    AgentServerPool,
    AgentTurnService,
    ApprovalHolds,
    GatewayCallsService,
    GatewayServerService,
    GrantRegistry,
    ToolDirectoryService,
    WorkerLanes,
    ChatSessionRepository,
    MessageRepository,
    ChatService,
    ChatHistoryService,
    ToolApprovalGateService,
    RemoteToolInvoker,
    RemoteToolSetService,
    SystemPromptService,
  ],
})
export class ChatModule {}
